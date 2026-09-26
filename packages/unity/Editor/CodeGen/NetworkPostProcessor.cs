using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Mono.Cecil;
using Mono.Cecil.Cil;
using Unity.CompilationPipeline.Common.Diagnostics;
using Unity.CompilationPipeline.Common.ILPostProcessing;

namespace RejourneySDK.CodeGen
{
    // ILPP sees source-compiled assemblies, including compiler-generated coroutine
    // and async types. It deliberately does not rewrite opaque precompiled DLLs.
    public sealed class NetworkPostProcessor : ILPostProcessor
    {
        const string Exclude = "RejourneySDK.RejourneyNetworkExcludeAttribute";
        public override ILPostProcessor GetInstance() => new NetworkPostProcessor();
        public override bool WillProcess(ICompiledAssembly assembly) =>
            !assembly.Defines.Contains("UNITY_EDITOR") && !assembly.Defines.Contains("REJOURNEY_DISABLE_AUTO_NETWORK") &&
            !IsPlatformAssembly(assembly.Name);
        // Whole names or dotted namespaces only: game assemblies such as
        // "Systems.Gameplay" or "UnityEngineExtensions" must still be woven.
        static readonly string[] platformAssemblies = { "Rejourney", "Unity", "UnityEngine", "UnityEditor", "System", "Microsoft", "mscorlib", "netstandard" };
        public static bool IsPlatformAssembly(string name)
        {
            foreach (var platform in platformAssemblies)
                if (name == platform || name.StartsWith(platform + ".", StringComparison.Ordinal)) return true;
            return false;
        }
        static bool Excluded(ICustomAttributeProvider provider) => provider.HasCustomAttributes && provider.CustomAttributes.Any(a => a.AttributeType.FullName == Exclude);
        public override ILPostProcessResult Process(ICompiledAssembly compiled)
        {
            if (!WillProcess(compiled)) return null;
            var diagnostics = new List<DiagnosticMessage>();
            try {
                using (var resolver = new DefaultAssemblyResolver()) {
                    foreach (var dir in compiled.References.Select(Path.GetDirectoryName).Distinct()) resolver.AddSearchDirectory(dir);
                    using (var pe = new MemoryStream(compiled.InMemoryAssembly.PeData))
                    using (var pdb = new MemoryStream(compiled.InMemoryAssembly.PdbData ?? Array.Empty<byte>()))
                    using (var assembly = AssemblyDefinition.ReadAssembly(pe, new ReaderParameters {
                        AssemblyResolver = resolver, ReadingMode = ReadingMode.Immediate,
                        ReadSymbols = pdb.Length > 0, SymbolStream = pdb.Length > 0 ? pdb : null,
                        SymbolReaderProvider = pdb.Length > 0 ? new PortablePdbReaderProvider() : null
                    })) {
                        var report = new List<string> { "Assembly: " + compiled.Name, "Input SHA256: " + Digest(compiled.InMemoryAssembly.PeData) };
                        if (Excluded(assembly)) { report.Add("Excluded by assembly attribute."); WriteReport(compiled.Name, report, 0); return null; }
                        var module = assembly.MainModule;
                        {
                            var runtimeReference = module.AssemblyReferences.FirstOrDefault(r => r.Name == "Rejourney.Runtime")
                                ?? new AssemblyNameReference("Rejourney.Runtime", new Version(0, 0, 0, 0));
                            var hooks = new TypeReference("RejourneySDK", "NetworkCapture", module, runtimeReference);
                            int changed = 0;
                            foreach (var type in Types(module.Types)) {
                                if (Excluded(type) || HasExcludedParent(type)) { report.Add("Excluded type: " + type.FullName); continue; }
                                foreach (var method in type.Methods) {
                                    if (!method.HasBody) continue;
                                    if (Excluded(method) || ExcludedOrigin(method)) { report.Add("Excluded method: " + method.FullName); continue; }
                                    foreach (var instruction in method.Body.Instructions) {
                                        if (!(instruction.Operand is MethodReference called)) continue;
                                        string hook = null;
                                        if ((instruction.OpCode == OpCodes.Call || instruction.OpCode == OpCodes.Callvirt) && called.DeclaringType.FullName == "UnityEngine.Networking.UnityWebRequest") {
                                            if (called.Name == "SendWebRequest" && called.Parameters.Count == 0) hook = "SendWebRequest";
                                            if (called.Name == "Dispose" && called.Parameters.Count == 0) hook = "Dispose";
                                        } else if (instruction.OpCode == OpCodes.Callvirt && called.DeclaringType.FullName == "System.IDisposable" && called.Name == "Dispose") hook = "Dispose";
                                        else if (instruction.OpCode == OpCodes.Newobj && called.DeclaringType.FullName == "System.Net.Http.HttpClient" && called.Name == ".ctor") hook = "CreateHttpClient";
                                        if (hook == null) continue;
                                        // constrained struct Dispose calls cannot be replaced by an object receiver.
                                        if (instruction.Previous?.OpCode == OpCodes.Constrained) { report.Add("Unsupported constrained Dispose: " + method.FullName); continue; }
                                        if (!module.AssemblyReferences.Contains(runtimeReference)) module.AssemblyReferences.Add(runtimeReference);
                                        var replacement = new MethodReference(hook,
                                            hook == "CreateHttpClient" ? module.ImportReference(called.DeclaringType) : module.ImportReference(called.ReturnType), hooks) { HasThis = false };
                                        if (hook != "CreateHttpClient") replacement.Parameters.Add(new ParameterDefinition(module.ImportReference(called.DeclaringType)));
                                        else foreach (var parameter in called.Parameters) replacement.Parameters.Add(new ParameterDefinition(module.ImportReference(parameter.ParameterType)));
                                        instruction.OpCode = OpCodes.Call;
                                        instruction.Operand = replacement;
                                        report.Add("Instrumented " + called.FullName + " in " + method.FullName);
                                        changed++;
                                    }
                                }
                            }
                            WriteReport(compiled.Name, report, changed);
                            if (changed == 0) return null;
                            using (var output = new MemoryStream()) using (var symbols = new MemoryStream()) {
                                assembly.Write(output, new WriterParameters { WriteSymbols = assembly.MainModule.HasSymbols,
                                    SymbolStream = assembly.MainModule.HasSymbols ? symbols : null,
                                    SymbolWriterProvider = assembly.MainModule.HasSymbols ? new PortablePdbWriterProvider() : null });
                                return new ILPostProcessResult(new InMemoryAssembly(output.ToArray(), symbols.ToArray()), diagnostics);
                            }
                        }
                    }
                }
            } catch (Exception error) {
                diagnostics.Add(new DiagnosticMessage { DiagnosticType = DiagnosticType.Error, MessageData = "Rejourney HTTP instrumentation failed for " + compiled.Name + ": " + error });
                return new ILPostProcessResult(null, diagnostics);
            }
        }
        static string Digest(byte[] bytes) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        static void WriteReport(string name, List<string> lines, int changed)
        {
            var directory = Path.Combine("Library", "Rejourney", "NetworkReports"); Directory.CreateDirectory(directory);
            lines.Insert(1, "Instrumented calls: " + changed);
            lines.Add("Coverage: source-compiled player assemblies only. Unity/System/Microsoft and Rejourney assemblies excluded. Reflection, native networking, WebSockets and opaque precompiled DLLs unsupported; use the manual API.");
            File.WriteAllLines(Path.Combine(directory, name + ".txt"), lines);
        }
        static bool ExcludedOrigin(MethodDefinition method)
        {
            foreach (var name in new[] { method.Name, method.DeclaringType.Name }) {
                if (!name.StartsWith("<", StringComparison.Ordinal)) continue;
                int end = name.IndexOf('>'); if (end <= 1) continue;
                string origin = name.Substring(1, end - 1);
                for (var owner = method.DeclaringType; owner != null; owner = owner.DeclaringType)
                    if (owner.Methods.Any(candidate => candidate.Name == origin && Excluded(candidate))) return true;
            }
            return false;
        }
        static bool HasExcludedParent(TypeDefinition type) { for (var parent = type.DeclaringType; parent != null; parent = parent.DeclaringType) if (Excluded(parent)) return true; return false; }
        static IEnumerable<TypeDefinition> Types(IEnumerable<TypeDefinition> types) { foreach (var type in types) { yield return type; foreach (var nested in Types(type.NestedTypes)) yield return nested; } }
    }
}
