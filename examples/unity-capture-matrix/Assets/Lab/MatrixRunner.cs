using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RejourneySDK;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace RejourneyLab
{
    /// <summary>
    /// Capture matrix: renders fixed colour markers, walks through render settings and
    /// checks the orientation and masking of every frame the SDK hands to its bridge.
    /// World quads (camera-rendered) fill the left half: red above blue. Screen Space -
    /// Overlay UI fills the right half: green above yellow, with a masked white box in
    /// the top-right corner. An optional overlay camera draws a magenta box top-left.
    /// </summary>
    public sealed class MatrixRunner : MonoBehaviour
    {
        // Forwards to the native bridge when there is one, and always shows frames to the runner.
        sealed class TeeBridge : IRejourneyBridge
        {
            readonly IRejourneyBridge inner;
            readonly Action<byte[], long> onFrame;
            internal TeeBridge(IRejourneyBridge inner, Action<byte[], long> onFrame) { this.inner = inner; this.onFrame = onFrame; }
            public Task<JObject> Request(string command, object payload = null)
            {
                if (inner != null) return inner.Request(command, payload);
                // Built by hand: anonymous types in this assembly do not survive high managed stripping.
                if (command == "start" || command == "status")
                    return Task.FromResult(new JObject { ["success"] = true, ["sessionId"] = "matrix-session", ["telemetryOnly"] = false, ["fps"] = 3, ["maskTextInputs"] = true, ["maskImagesAndVideos"] = false });
                return Task.FromResult(new JObject { ["success"] = true, ["delivered"] = true });
            }
            public void Poll() => inner?.Poll();
            public void Frame(byte[] bytes, string session, long timestamp)
            {
                onFrame((byte[])bytes.Clone(), timestamp);
                inner?.Frame(bytes, session, timestamp);
            }
            public void Dispose() => inner?.Dispose();
        }

        sealed class Config
        {
            public string Pipeline = "urp";      // urp | builtin
            public int Renderer;                 // 0 default, 1 intermediate always, 2 tile-only
            public bool PipelineSource;          // true: capture inside the pipeline (write-only back buffer)
            public int Msaa = 1;
            public bool Hdr;
            public float Scale = 1f;
            public int PostProcessing;           // 0 off, 1 on, 2 on + FXAA
            public bool Stack;
            public bool DepthTexture;
            public bool OpaqueTexture;
            public bool DynamicResolution;
            public int FrameInterval = 1;        // OnDemandRendering.renderFrameInterval
            public string Orientation;           // null keeps the current one
            public string Name => Pipeline + (Pipeline == "urp" ? "/r" + Renderer : "") + "/" + (PipelineSource ? "pipeline" : "screen") + "/msaa" + Msaa + (Hdr ? "/hdr" : "/ldr")
                + "/scale" + Scale.ToString("0.0#", System.Globalization.CultureInfo.InvariantCulture) + "/pp" + PostProcessing + (Stack ? "/stack" : "") + (DepthTexture ? "/depth" : "")
                + (OpaqueTexture ? "/opaque" : "") + (DynamicResolution ? "/dynres" : "") + (FrameInterval > 1 ? "/ondemand" + FrameInterval : "") + (Orientation != null ? "/" + Orientation : "");
        }

        readonly Queue<(byte[] bytes, long timestamp)> frames = new Queue<(byte[], long)>();
        readonly List<string> errors = new List<string>();
        readonly List<JObject> results = new List<JObject>();
        Camera mainCamera, overlayCamera;
        Transform red, blue, magenta;
        UniversalRenderPipelineAsset pipeline;
        Material unlit;
        string reportPath, filter;
        bool native, quick, screenReadable;
        int rotationErrors = -1;
        string sessionAtStart;
        readonly WaitForEndOfFrame endOfFrame = new WaitForEndOfFrame();

        static string Argument(string name) => LabArgs.Value(name);
        static bool Flag(string name) => LabArgs.Flag(name);

        IEnumerator Start()
        {
            Application.targetFrameRate = 60;
            Application.runInBackground = true;
            var local = Resources.Load<TextAsset>("MatrixLocal");
            var settings = local ? JObject.Parse(local.text) : new JObject();
            // The lab keeps its own log: device consoles are not always reachable.
            string logPath = Path.Combine(Application.persistentDataPath, "lab.log");
            try { File.WriteAllText(logPath, ""); } catch { }
            Application.logMessageReceivedThreaded += (message, stack, type) => {
                if (!message.StartsWith("[", StringComparison.Ordinal) && type == LogType.Log) return;
                try { lock (logPath) File.AppendAllText(logPath, DateTime.UtcNow.ToString("HH:mm:ss.fff") + " " + type + " " + message + (type == LogType.Exception ? "\n" + stack : "") + "\n"); } catch { }
            };
            Debug.Log("[Lab] args " + string.Join(" ", LabArgs.All));
            string probe = Argument("--crash-probe");
            if (probe != null) { BuildScene(Resources.Load<Material>("Lab/LabUnlit")); yield return CrashLab.Probe(probe, settings); yield break; }
            if (Flag("--perf")) { BuildScene(Resources.Load<Material>("Lab/LabUnlit")); yield return PerfLab.Run(settings, unlit); yield break; }
            if (Flag("--crash-recover")) { BuildScene(Resources.Load<Material>("Lab/LabUnlit")); yield return CrashLab.Recover(settings); yield break; }
            reportPath = Argument("--matrix-report") ?? Path.Combine(Application.persistentDataPath, "matrix-report.json");
            filter = Argument("--matrix-filter") ?? settings.Value<string>("filter");
            quick = Flag("--matrix-quick") || (settings.Value<bool?>("quick") ?? false);
            // With the native bridge the run is also a real cloud session.
            native = (Application.platform == RuntimePlatform.IPhonePlayer || Application.platform == RuntimePlatform.Android) && (settings.Value<bool?>("native") ?? true) && !Flag("--matrix-loopback");
            Application.logMessageReceived += (message, stack, type) => {
                if ((type == LogType.Error || type == LogType.Exception || type == LogType.Assert) && errors.Count < 8) errors.Add(message.Length > 300 ? message.Substring(0, 300) : message);
            };
            // The simulator and desktop players can read the back buffer whatever the build setting says.
            screenReadable = !(settings.Value<bool?>("writeOnlyBackbuffer") ?? false);
            pipeline = Resources.Load<UniversalRenderPipelineAsset>("Lab/LabPipeline");
            BuildScene(Resources.Load<Material>("Lab/LabUnlit"));
            RejourneyBehaviour.BridgeFactory = () => new TeeBridge(native ? new NativeBridge() : null, (bytes, timestamp) => { lock (frames) frames.Enqueue((bytes, timestamp)); });
            Rejourney.Init(settings.Value<string>("publicProjectKey") ?? "rj_matrix_loopback", new RejourneyOptions {
                ApiUrl = settings.Value<string>("apiUrl") ?? "https://api.rejourney.co", FramesPerSecond = 3, CaptureLogs = false, CaptureHangs = false,
                CaptureCrashes = false, CaptureTouches = false, Debug = true });
            var start = Rejourney.StartAsync();
            while (!start.IsCompleted) yield return null;
            Debug.Log("[Matrix] start state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " api=" + SystemInfo.graphicsDeviceType + " uvTop=" + SystemInfo.graphicsUVStartsAtTop
                + " unity=" + Application.unityVersion + " platform=" + Application.platform + " screen=" + Screen.width + "x" + Screen.height);
            sessionAtStart = Rejourney.CurrentSessionId;
            if (Rejourney.State != CaptureState.Recording) { Finish("not_recording:" + Rejourney.State + ":" + start.Result.Error); yield break; }
            Rejourney.SetMetadata("matrixRun", Argument("--matrix-run") ?? settings.Value<string>("run") ?? "local");
            foreach (var config in Configs()) {
                if (!string.IsNullOrEmpty(filter) && config.Name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                yield return Run(config);
            }
            if (native) {
                var stop = Rejourney.StopAsync();
                while (!stop.IsCompleted) yield return null;
                Debug.Log("[Matrix] stop delivery=" + stop.Result.State + " error=" + stop.Result.Error);
            }
            Finish(null);
        }

        IEnumerable<Config> Configs()
        {
            bool mobile = Application.isMobilePlatform;
            int[] msaa = quick ? new[] { 1, 4 } : new[] { 1, 2, 4 };
            foreach (int renderer in new[] { 0, 1, 2 })
            foreach (bool source in new[] { false, true })
            foreach (int samples in msaa)
            foreach (bool hdr in new[] { false, true })
            foreach (float scale in new[] { 1f, 0.8f })
            foreach (int post in new[] { 0, 1, 2 })
            foreach (bool stack in new[] { false, true }) {
                // Keep the full cross product for the default renderer; the others vary one axis at a time less densely.
                if (renderer != 0 && (samples == 2 || post == 2)) continue;
                if (quick && (post == 2 || (stack && hdr && scale < 1f))) continue;
                yield return new Config { Renderer = renderer, PipelineSource = source, Msaa = samples, Hdr = hdr, Scale = scale, PostProcessing = post, Stack = stack };
            }
            foreach (bool source in new[] { false, true })
            foreach (int samples in new[] { 1, 4 }) {
                yield return new Config { PipelineSource = source, Msaa = samples, DepthTexture = true };
                yield return new Config { PipelineSource = source, Msaa = samples, OpaqueTexture = true };
                yield return new Config { PipelineSource = source, Msaa = samples, DepthTexture = true, OpaqueTexture = true, Hdr = true, PostProcessing = 1 };
                yield return new Config { PipelineSource = source, Msaa = samples, DynamicResolution = true };
                yield return new Config { PipelineSource = source, Msaa = samples, DynamicResolution = true, Hdr = true, PostProcessing = 1 };
            }
            foreach (bool source in new[] { false, true })
            foreach (int samples in new[] { 1, 4 }) {
                // Rendering every fourth loop iteration, and the 2D renderer.
                yield return new Config { PipelineSource = source, Msaa = samples, FrameInterval = 4 };
                yield return new Config { PipelineSource = source, Msaa = samples, FrameInterval = 4, Hdr = true, Scale = 0.8f, PostProcessing = 1 };
                yield return new Config { Renderer = 3, PipelineSource = source, Msaa = samples };
                yield return new Config { Renderer = 3, PipelineSource = source, Msaa = samples, Hdr = true, PostProcessing = 1 };
            }
            foreach (int samples in new[] { 1, 2, 4 })
            foreach (bool hdr in new[] { false, true })
                yield return new Config { Pipeline = "builtin", Msaa = samples, Hdr = hdr };
            yield return new Config { Pipeline = "builtin", Msaa = 1, FrameInterval = 4 };
            yield return new Config { Pipeline = "builtin", PipelineSource = true };
            if (mobile) {
                foreach (string orientation in new[] { "LandscapeLeft", "LandscapeRight", "Portrait", "PortraitUpsideDown", "LandscapeLeft" })
                foreach (bool source in new[] { false, true })
                foreach (int samples in new[] { 1, 4 }) {
                    yield return new Config { PipelineSource = source, Msaa = samples, Orientation = orientation };
                    yield return new Config { PipelineSource = source, Msaa = samples, Hdr = true, Scale = 0.8f, PostProcessing = 1, Orientation = orientation };
                }
                yield return new Config { Pipeline = "builtin", Msaa = 4, Orientation = "Portrait" };
                yield return new Config { Pipeline = "builtin", Msaa = 1, Orientation = "LandscapeLeft" };
            }
        }

        void BuildScene(Material material)
        {
            unlit = material;
            mainCamera = new GameObject("Main Camera") { tag = "MainCamera" }.AddComponent<Camera>();
            mainCamera.orthographic = true; mainCamera.orthographicSize = 1; mainCamera.clearFlags = CameraClearFlags.SolidColor;
            mainCamera.backgroundColor = Color.black; mainCamera.transform.position = new Vector3(0, 0, -10);
            mainCamera.cullingMask = ~(1 << 4);
            mainCamera.gameObject.AddComponent<UniversalAdditionalCameraData>();
            overlayCamera = new GameObject("Overlay Camera").AddComponent<Camera>();
            overlayCamera.orthographic = true; overlayCamera.orthographicSize = 1; overlayCamera.transform.position = new Vector3(0, 0, -10);
            overlayCamera.cullingMask = 1 << 4; overlayCamera.clearFlags = CameraClearFlags.Depth;
            overlayCamera.gameObject.AddComponent<UniversalAdditionalCameraData>().renderType = CameraRenderType.Overlay;
            overlayCamera.gameObject.SetActive(false);
            red = Quad("Red", Color.red, 0); blue = Quad("Blue", Color.blue, 0); magenta = Quad("Magenta", Color.magenta, 4);
            Layout();

            var canvasObject = new GameObject("Canvas");
            var canvas = canvasObject.AddComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            Panel(canvasObject.transform, "Green", Color.green, new Vector2(0.5f, 0.5f), new Vector2(1f, 1f));
            Panel(canvasObject.transform, "Yellow", Color.yellow, new Vector2(0.5f, 0f), new Vector2(1f, 0.5f));
            // Top-right corner: must arrive as the mask's grey, never white.
            Panel(canvasObject.transform, "Secret", Color.white, new Vector2(0.8f, 0.8f), new Vector2(0.95f, 0.95f)).AddComponent<RejourneyMask>();
        }

        Transform Quad(string name, Color color, int layer)
        {
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = name; quad.layer = layer;
            Destroy(quad.GetComponent<Collider>());
            quad.GetComponent<Renderer>().sharedMaterial = new Material(unlit) { color = color };
            return quad.transform;
        }

        static GameObject Panel(Transform parent, string name, Color color, Vector2 min, Vector2 max)
        {
            var panel = new GameObject(name, typeof(RectTransform));
            panel.transform.SetParent(parent, false);
            var rect = (RectTransform)panel.transform;
            rect.anchorMin = min; rect.anchorMax = max; rect.offsetMin = rect.offsetMax = Vector2.zero;
            panel.AddComponent<Image>().color = color;
            return panel;
        }

        void Layout()
        {
            float aspect = mainCamera.aspect;
            red.position = new Vector3(-aspect / 2, 0.5f, 0); red.localScale = new Vector3(aspect, 1, 1);
            blue.position = new Vector3(-aspect / 2, -0.5f, 0); blue.localScale = new Vector3(aspect, 1, 1);
            // Top-left corner, in front of the red quad, drawn only by the overlay camera.
            magenta.position = new Vector3(-aspect * 0.875f, 0.75f, -1); magenta.localScale = new Vector3(aspect * 0.15f, 0.3f, 1);
        }

        IEnumerator Apply(Config config)
        {
            if (config.Orientation != null && Application.isMobilePlatform) {
                var wanted = (ScreenOrientation)Enum.Parse(typeof(ScreenOrientation), config.Orientation);
                if (Screen.orientation != wanted) {
                    // Control run: with the SDK paused across the rotation, anything logged is the engine's own.
                    bool pauseSdk = Flag("--matrix-pause-rotation");
                    if (pauseSdk) { var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null; }
                    bool wasLandscape = Screen.width > Screen.height;
                    Screen.orientation = wanted;
                    bool wantsLandscape = config.Orientation.StartsWith("Landscape", StringComparison.Ordinal);
                    for (float waited = 0; waited < 3f && (Screen.width > Screen.height) != wantsLandscape; waited += Time.unscaledDeltaTime) yield return null;
                    // A half turn keeps the size; give the rotation time to finish.
                    if (wasLandscape == wantsLandscape) yield return new WaitForSecondsRealtime(1.2f);
                    else yield return new WaitForSecondsRealtime(0.6f);
                    if (pauseSdk) {
                        rotationErrors = errors.Count;
                        var resume = Rejourney.ResumeAsync(); while (!resume.IsCompleted) yield return null;
                    }
                }
            }
            bool urp = config.Pipeline == "urp";
            var asset = urp ? pipeline : null;
            if (GraphicsSettings.defaultRenderPipeline != asset) GraphicsSettings.defaultRenderPipeline = asset;
            if (QualitySettings.renderPipeline != asset) QualitySettings.renderPipeline = asset;
            CaptureEnvironment.Override = config.PipelineSource;
            var data = mainCamera.GetComponent<UniversalAdditionalCameraData>();
            if (urp) {
                pipeline.msaaSampleCount = config.Msaa; pipeline.supportsHDR = config.Hdr; pipeline.renderScale = config.Scale;
                data.SetRenderer(config.Renderer);
                data.renderPostProcessing = config.PostProcessing > 0;
                data.antialiasing = config.PostProcessing == 2 ? AntialiasingMode.FastApproximateAntialiasing : AntialiasingMode.None;
                data.requiresDepthTexture = config.DepthTexture; data.requiresColorTexture = config.OpaqueTexture;
                data.cameraStack.Clear();
                overlayCamera.gameObject.SetActive(config.Stack);
                if (config.Stack) { overlayCamera.GetComponent<UniversalAdditionalCameraData>().SetRenderer(config.Renderer); data.cameraStack.Add(overlayCamera); }
            } else {
                QualitySettings.antiAliasing = config.Msaa == 1 ? 0 : config.Msaa;
                overlayCamera.gameObject.SetActive(false);
            }
            OnDemandRendering.renderFrameInterval = config.FrameInterval;
            mainCamera.allowHDR = config.Hdr; mainCamera.allowMSAA = true;
            mainCamera.allowDynamicResolution = config.DynamicResolution;
            if (config.DynamicResolution) ScalableBufferManager.ResizeBuffers(0.7f, 0.7f); else ScalableBufferManager.ResizeBuffers(1f, 1f);
            Layout();
        }

        IEnumerator Run(Config config)
        {
            errors.Clear();
            yield return Apply(config);
            for (int i = 0; i < 4 * config.FrameInterval; i++) yield return null;
            Layout();
            yield return null;
            long settled = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            lock (frames) frames.Clear();
            var health = Rejourney.Health;
            long failuresBefore = health.CaptureFailures, unreadableBefore = health.FramesSkippedUnreadable;
            byte[] jpeg = null;
            // While a pipeline capture runs, the presented frame must stay intact: read the
            // real back buffer on every frame (possible here, never on a write-only device).
            // The same read is what a game's own end-of-frame screenshot does, so it also proves
            // the SDK leaves the active render target alone, on both capture paths.
            bool watchScreen = screenReadable;
            int screenFrames = 0, screenBad = 0; string screenProblem = null;
            // At least four seconds and forty loop iterations: a slow emulator can spend seconds on one frame.
            int iterations = 0;
            for (float waited = 0; (waited < 4f || iterations < 40) && waited < 30f && jpeg == null; waited += Time.unscaledDeltaTime) {
                iterations++;
                Rejourney.MarkVisualChange();
                if (watchScreen && !OnDemandRendering.willCurrentFrameRender) yield return null;
                else if (watchScreen) {
                    yield return endOfFrame;
                    var shot = ScreenCapture.CaptureScreenshotAsTexture();
                    var check = new JObject();
                    Evaluate(shot, config, check, false);
                    Destroy(shot);
                    screenFrames++;
                    if ((string)check["verdict"] != "ok") { screenBad++; screenProblem = check.ToString(Newtonsoft.Json.Formatting.None); }
                } else yield return null;
                lock (frames) while (frames.Count > 0) { var frame = frames.Dequeue(); if (frame.timestamp >= settled) jpeg = frame.bytes; }
            }
            var result = new JObject {
                ["config"] = config.Name, ["source"] = health.CaptureSource, ["screen"] = Screen.width + "x" + Screen.height,
                ["orientation"] = Screen.orientation.ToString(), ["captureFailures"] = health.CaptureFailures - failuresBefore,
                ["unreadable"] = health.FramesSkippedUnreadable - unreadableBefore,
            };
            if (jpeg == null) { result["verdict"] = health.FramesSkippedUnreadable > unreadableBefore ? "skipped_unreadable" : "no_frame"; result["reason"] = health.CaptureUnavailableReason; }
            else {
                var texture = new Texture2D(2, 2, TextureFormat.RGB24, false);
                if (!texture.LoadImage(jpeg)) result["verdict"] = "undecodable"; else Evaluate(texture, config, result, true);
                Destroy(texture);
            }
            if (watchScreen) { result["screenFrames"] = screenFrames; result["screenBad"] = screenBad; if (screenProblem != null) result["screenProblem"] = screenProblem; }
            if (errors.Count > 0) result["errors"] = new JArray(errors.ToArray());
            if (rotationErrors >= 0) { result["errorsWhileSdkPaused"] = rotationErrors; rotationErrors = -1; }
            // A write-only back buffer cannot be captured without URP, nor with a Tile-Only renderer.
            bool expectedSkip = config.PipelineSource && (config.Pipeline == "builtin" || config.Renderer == 2) && (string)result["verdict"] == "skipped_unreadable";
            result["pass"] = ((string)result["verdict"] == "ok" || expectedSkip) && errors.Count == 0 && screenBad == 0;
            results.Add(result);
            Debug.Log("[Matrix] " + result.ToString(Newtonsoft.Json.Formatting.None));
            if (native) Rejourney.LogEvent("matrix_config", new Dictionary<string, object> { ["name"] = config.Name, ["verdict"] = (string)result["verdict"] });
        }

        static string Classify(Color c)
        {
            float r = c.r, g = c.g, b = c.b;
            if (r > 0.75f && g > 0.75f && b > 0.75f) return "white";
            if (r > 0.5f && g < 0.35f && b < 0.35f) return "red";
            if (b > 0.5f && r < 0.35f && g < 0.35f) return "blue";
            if (g > 0.5f && r < 0.35f && b < 0.35f) return "green";
            if (r > 0.5f && g > 0.5f && b < 0.35f) return "yellow";
            if (r > 0.5f && b > 0.5f && g < 0.35f) return "magenta";
            if (r < 0.04f && g < 0.04f && b < 0.04f) return "black";
            if (r > 0.05f && r < 0.3f && Mathf.Abs(r - g) < 0.04f && Mathf.Abs(r - b) < 0.04f) return "grey";
            return "rgb(" + Mathf.RoundToInt(r * 255) + "," + Mathf.RoundToInt(g * 255) + "," + Mathf.RoundToInt(b * 255) + ")";
        }

        void Evaluate(Texture2D texture, Config config, JObject result, bool masked)
        {
            {
                // (x, y) are fractions from the top-left corner of the upright image.
                string At(float x, float y)
                {
                    int px = Mathf.Clamp(Mathf.RoundToInt(x * texture.width), 2, texture.width - 3), py = Mathf.Clamp(Mathf.RoundToInt((1 - y) * texture.height), 2, texture.height - 3);
                    Color sum = Color.clear;
                    for (int dx = -2; dx <= 2; dx++) for (int dy = -2; dy <= 2; dy++) sum += texture.GetPixel(px + dx, py + dy);
                    return Classify(sum / 25f);
                }
                string topLeft = At(0.3f, 0.3f), bottomLeft = At(0.3f, 0.7f), topRight = At(0.7f, 0.3f), bottomRight = At(0.7f, 0.7f);
                string secret = At(0.875f, 0.125f), mirrored = At(0.875f, 0.875f), corner = At(0.0625f, 0.125f);
                result["size"] = texture.width + "x" + texture.height;
                result["samples"] = topLeft + "," + bottomLeft + "," + topRight + "," + bottomRight + "," + secret + "," + mirrored + "," + corner;
                string world = topLeft == "red" && bottomLeft == "blue" ? "upright" : topLeft == "blue" && bottomLeft == "red" ? "flipped" : "wrong(" + topLeft + "/" + bottomLeft + ")";
                string ui = topRight == "green" && bottomRight == "yellow" ? "upright" : topRight == "yellow" && bottomRight == "green" ? "flipped"
                    : topRight == "black" && bottomRight == "black" ? "missing" : "wrong(" + topRight + "/" + bottomRight + ")";
                string mask = !masked ? (secret == "white" && mirrored == "yellow" ? "ok" : "wrong(" + secret + "/" + mirrored + ")")
                    : secret == "grey" && mirrored == "yellow" ? "ok" : secret == "white" || mirrored == "white" ? "LEAK" : "wrong(" + secret + "/" + mirrored + ")";
                // Tile-Only renderers do not draw overlay cameras at all.
                bool stack = config.Stack && config.Pipeline == "urp" && config.Renderer != 2 && config.Renderer != 3;
                string overlay = !stack ? (corner == "red" ? "ok" : "wrong(" + corner + ")") : corner == "magenta" ? "ok" : "missing(" + corner + ")";
                // Scale and offset: just either side of the centre lines, and just outside the masked box.
                // A layer drawn at the wrong size keeps its colours at the quadrant centres but not here.
                string edges = At(0.47f, 0.25f) + "," + At(0.53f, 0.25f) + "," + At(0.47f, 0.75f) + "," + At(0.53f, 0.75f) + ","
                    + At(0.25f, 0.46f) + "," + At(0.25f, 0.54f) + "," + At(0.75f, 0.46f) + "," + At(0.75f, 0.54f) + ","
                    + At(0.77f, 0.125f) + "," + At(0.975f, 0.125f) + "," + At(0.875f, 0.02f) + "," + At(0.875f, 0.23f);
                string layout = edges == "red,green,blue,yellow,red,blue,green,yellow,green,green,green,green" ? "ok" : "wrong(" + edges + ")";
                result["layout"] = layout;
                bool landscapeScreen = Screen.width >= Screen.height, landscapeFrame = texture.width >= texture.height;
                string shape = landscapeScreen == landscapeFrame ? "ok" : "rotated";
                result["world"] = world; result["ui"] = ui; result["mask"] = mask; result["overlay"] = overlay; result["shape"] = shape;
                result["verdict"] = world == "upright" && ui == "upright" && mask == "ok" && overlay == "ok" && shape == "ok" && layout == "ok" ? "ok" : "FAIL";
            }
        }

        void Finish(string fatal)
        {
            int passed = 0; var failures = new JArray();
            foreach (var result in results) { if ((bool)result["pass"]) passed++; else failures.Add(result); }
            var report = new JObject {
                ["fatal"] = fatal, ["platform"] = Application.platform.ToString(), ["graphicsApi"] = SystemInfo.graphicsDeviceType.ToString(),
                ["uvStartsAtTop"] = SystemInfo.graphicsUVStartsAtTop, ["unity"] = Application.unityVersion, ["device"] = SystemInfo.deviceModel,
                ["session"] = sessionAtStart, ["args"] = string.Join(" ", LabArgs.All), ["native"] = native, ["total"] = results.Count, ["passed"] = passed, ["failed"] = results.Count - passed,
                ["failures"] = failures, ["results"] = new JArray(results.ToArray()),
            };
            try { File.WriteAllText(reportPath, report.ToString(Newtonsoft.Json.Formatting.Indented), Encoding.UTF8); } catch (Exception error) { Debug.Log("[Matrix] report write failed: " + error.Message); }
            Debug.Log("[Matrix] DONE total=" + results.Count + " passed=" + passed + " failed=" + (results.Count - passed) + " fatal=" + fatal + " report=" + reportPath);
            if (!Application.isMobilePlatform) Application.Quit(results.Count - passed > 0 || fatal != null ? 1 : 0);
            else done = true;
        }
        bool done;
        void OnGUI()
        {
            if (!done) return;
            GUI.Label(new Rect(20, 20, 600, 40), "Matrix finished: " + results.Count + " configs");
        }
    }
}
