using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using Mono.Cecil;
using Mono.Cecil.Cil;
using NUnit.Framework;
using RejourneySDK;
using RejourneySDK.CodeGen;
using Unity.CompilationPipeline.Common.ILPostProcessing;
using UnityEngine.Networking;

public sealed class WeaverTests
{
    sealed class Compiled : ICompiledAssembly
    {
        public string Name => "Arcade.SourcePackageFixture";
        public string[] Defines { get; set; } = new[] { "UNITY_ANDROID", "ENABLE_IL2CPP" };
        public string[] References => new[] { typeof(NetworkCapture).Assembly.Location, typeof(UnityWebRequest).Assembly.Location, typeof(HttpClient).Assembly.Location, typeof(object).Assembly.Location };
        public InMemoryAssembly InMemoryAssembly { get; set; }
    }
    static Compiled Fixture(bool excluded = false)
    {
        using (var assembly = AssemblyDefinition.CreateAssembly(new AssemblyNameDefinition("Arcade.SourcePackageFixture", new Version(1,0)), "Arcade", ModuleKind.Dll)) {
            var m = assembly.MainModule;
            var owner = new TypeDefinition("Fixture", "Game", TypeAttributes.Public, m.TypeSystem.Object); m.Types.Add(owner);
            var nested = new TypeDefinition("", "<Fetch>d__0", TypeAttributes.NestedPublic, m.TypeSystem.Object); owner.NestedTypes.Add(nested);
            var method = new MethodDefinition("MoveNext", MethodAttributes.Public | MethodAttributes.Static, m.TypeSystem.Void); nested.Methods.Add(method);
            if (excluded) owner.CustomAttributes.Add(new CustomAttribute(m.ImportReference(typeof(RejourneyNetworkExcludeAttribute).GetConstructor(Type.EmptyTypes))));
            var il = method.Body.GetILProcessor();
            il.Emit(OpCodes.Ldnull);
            il.Emit(OpCodes.Callvirt, m.ImportReference(typeof(UnityWebRequest).GetMethod("SendWebRequest")));
            il.Emit(OpCodes.Pop);
            il.Emit(OpCodes.Newobj, m.ImportReference(typeof(HttpClient).GetConstructor(Type.EmptyTypes)));
            il.Emit(OpCodes.Callvirt, m.ImportReference(typeof(IDisposable).GetMethod("Dispose")));
            il.Emit(OpCodes.Ret);
            method.DebugInformation.SequencePoints.Add(new SequencePoint(method.Body.Instructions[0], new Document("SourcePackageFixture.cs")) { StartLine = 5, EndLine = 5, StartColumn = 1, EndColumn = 10 });
            using (var bytes = new MemoryStream()) using (var symbols = new MemoryStream()) {
                assembly.Write(bytes, new WriterParameters { WriteSymbols = true, SymbolStream = symbols, SymbolWriterProvider = new PortablePdbWriterProvider() });
                return new Compiled { InMemoryAssembly = new InMemoryAssembly(bytes.ToArray(), symbols.ToArray()) };
            }
        }
    }
    [Test] public void SourcePackageWithoutSdkReferenceGetsHooksAndKeepsSymbols()
    {
        var input = Fixture(); var processor = new NetworkPostProcessor();
        var result = processor.Process(input);
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.That(result.InMemoryAssembly.PdbData.Length, Is.GreaterThan(0));
        using (var assembly = AssemblyDefinition.ReadAssembly(new MemoryStream(result.InMemoryAssembly.PeData))) {
            var calls = assembly.MainModule.Types.Single(t => t.Name == "Game").NestedTypes[0].Methods[0].Body.Instructions
                .Select(i => i.Operand as MethodReference).Where(m => m != null).ToArray();
            Assert.That(calls.Select(m => m.Name), Is.EqualTo(new[] { "SendWebRequest", "CreateHttpClient", "Dispose" }));
            Assert.That(calls.All(m => m.DeclaringType.FullName == "RejourneySDK.NetworkCapture" && !m.HasThis), Is.True);
            Assert.That(assembly.MainModule.AssemblyReferences.Any(r => r.Name == "Rejourney.Runtime"), Is.True);
        }
        input.InMemoryAssembly = result.InMemoryAssembly;
        Assert.That(processor.Process(input), Is.Null, "weaving a second time must not wrap hooks again");
    }
    [Test] public void ExclusionCoversNestedStateMachines() => Assert.That(new NetworkPostProcessor().Process(Fixture(true)), Is.Null);
    [Test] public void EditorAndExplicitDisableAreExcluded()
    {
        var input = Fixture(); input.Defines = new[] { "UNITY_EDITOR" };
        Assert.That(new NetworkPostProcessor().WillProcess(input), Is.False);
        input.Defines = new[] { "UNITY_ANDROID", "REJOURNEY_DISABLE_AUTO_NETWORK" };
        Assert.That(new NetworkPostProcessor().WillProcess(input), Is.False);
    }
    [TestCase("Systems.Gameplay", false)]
    [TestCase("SystemsCore", false)]
    [TestCase("UnityEngineExtensions", false)]
    [TestCase("Assembly-CSharp", false)]
    [TestCase("System", true)]
    [TestCase("System.Net.Http", true)]
    [TestCase("UnityEngine.UI", true)]
    [TestCase("Unity.TextMeshPro", true)]
    [TestCase("Rejourney.Runtime", true)]
    public void PlatformAssemblyFilterMatchesWholeNamesOnly(string name, bool platform) =>
        Assert.That(NetworkPostProcessor.IsPlatformAssembly(name), Is.EqualTo(platform));
}
