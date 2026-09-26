using System;
using System.Collections;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using RejourneySDK;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;
using UnityEngine.EventSystems;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
#endif
using UnityEngine.UIElements;
using UnityEngine.Rendering;
using TMPro;
using Random = UnityEngine.Random;
using Button = UnityEngine.UI.Button;
using Image = UnityEngine.UI.Image;

public sealed class ArcadeLab : MonoBehaviour
{
    [Serializable] sealed class LocalConfiguration { public string publicProjectKey; public string apiUrl = "https://api.rejourney.co"; }
    string key = "", endpoint = "https://api.rejourney.co", message = "Configure the cloud-issued public key, then grant consent.";
    string runId;
    bool consent, running, sdkDisabled, telemetryOnly, scripted;
    int score;
    Transform player, sensitive;
    readonly List<Transform> coins = new List<Transform>();
    readonly List<GameObject> rooms = new List<GameObject>();
    Camera camera;
    Font font;
    float startTime;
    int room;
    UIDocument toolkit;
    GameObject worldPrivacy;
    ArcadeBenchmark benchmark;
    static readonly string[] names = { "Arena", "Shop", "Privacy", "Network", "Fault", "Lifecycle", "Stress" };
    readonly Queue<float> recentFrameTimes = new Queue<float>();
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Launch() { if (FindFirstObjectByType<ArcadeLab>() == null) new GameObject("Rejourney Arcade Lab").AddComponent<ArcadeLab>(); }
    void Awake()
    {
        Application.targetFrameRate = 60;
        font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var config = Resources.Load<TextAsset>("RejourneyLocal");
        if (config) { var local = JsonUtility.FromJson<LocalConfiguration>(config.text); key = local.publicProjectKey; endpoint = local.apiUrl; }
        runId = "unity-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
        BuildArena(); BuildInterface(); benchmark = gameObject.AddComponent<ArcadeBenchmark>(); startTime = Time.realtimeSinceStartup;
    }
#if REJOURNEY_LAB_AUTOMATION
    const bool LabAutomationBuild = true;
#else
    const bool LabAutomationBuild = false;
#endif
    // Development players and the lab-automation lane honor operator opt-in files.
    // A runtime check replaces DEVELOPMENT_BUILD, which Unity 6.6 deprecates.
    static bool AutomationAllowed => Debug.isDebugBuild || Application.isEditor || LabAutomationBuild;
    [Serializable] sealed class ValidationLaunch { public bool consent; public bool telemetryOnly; }
    // Scene baselines isolate SDK cost from each scenario's own rendering and load.
    [Serializable] sealed class SuiteLaunch {
        public string[] cases = { "disabled", "telemetry", "replay", "replay-hires", "disabled-privacy", "replay-privacy", "disabled-stress", "replay-stress" };
        public int seconds = 60, warmupSeconds = 10, rounds = 1;
    }
    IEnumerator Start()
    {
        // Explicit operator opt-in for synthetic device runs. Normal launches
        // still require the on-screen consent button. Ordinary release builds
        // ignore these files; only the lab-automation build lane honors them.
        if (!AutomationAllowed) yield break;
        string suiteFile = System.IO.Path.Combine(Application.persistentDataPath, "rejourney-benchmark.json");
        if (System.IO.File.Exists(suiteFile)) {
            var suite = JsonUtility.FromJson<SuiteLaunch>(System.IO.File.ReadAllText(suiteFile));
            System.IO.File.Delete(suiteFile);
            consent = true;
            yield return BenchmarkSuite(suite ?? new SuiteLaunch());
            yield break;
        }
        var args = Environment.GetCommandLineArgs();
        bool validationConsent = Array.IndexOf(args, "--rejourney-validation-consent") >= 0;
        ValidationLaunch launch = null;
        // iOS players may not forward process argv into IL2CPP. Operators can
        // instead copy this one-use synthetic validation opt-in into Documents.
        string launchFile = System.IO.Path.Combine(Application.persistentDataPath, "rejourney-validation.json");
        if (System.IO.File.Exists(launchFile)) {
            launch = JsonUtility.FromJson<ValidationLaunch>(System.IO.File.ReadAllText(launchFile));
            System.IO.File.Delete(launchFile);
            validationConsent |= launch != null && launch.consent;
        }
        Debug.Log("[ArcadeLab] Ready. Validation consent: " + validationConsent);
        if (!validationConsent) yield break;
        int keyIndex = Array.IndexOf(args, "--rejourney-project-key");
        if (keyIndex >= 0 && keyIndex + 1 < args.Length) key = args[keyIndex + 1];
        telemetryOnly = (launch != null && launch.telemetryOnly) || Array.IndexOf(args, "--rejourney-telemetry-only") >= 0;
        consent = true; Begin();
        float deadline = Time.realtimeSinceStartup + 120;
        while (!running && Rejourney.State == CaptureState.Starting && Time.realtimeSinceStartup < deadline) yield return null;
        string session = Rejourney.CurrentSessionId;
        string startState = Rejourney.State.ToString();
        if (running) yield return ScriptedRun();
        var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
        var report = new {
            testRunId = runId, sessionId = session, startState, stopState = stop.Result.State.ToString(),
            error = stop.Result.Error, health = Rejourney.Health, settings = Rejourney.Settings,
            unityVersion = Application.unityVersion, buildIdentifier = Application.buildGUID,
            platform = Application.platform.ToString(), graphicsApi = SystemInfo.graphicsDeviceType.ToString(),
            completedAt = DateTime.UtcNow.ToString("O")
        };
        var reportPath = System.IO.Path.Combine(Application.persistentDataPath, "validation-" + runId + ".json");
        System.IO.File.WriteAllText(reportPath, Newtonsoft.Json.JsonConvert.SerializeObject(report, Newtonsoft.Json.Formatting.Indented));
        Debug.Log("[ArcadeLab] Validation report: " + reportPath + " session=" + session + " start=" + startState + " stop=" + stop.Result.State);
        running = false;
    }
    IEnumerator BenchmarkSuite(SuiteLaunch launch)
    {
        var results = new List<object>();
        Debug.Log("[ArcadeLab] Benchmark suite " + runId + ": " + string.Join(",", launch.cases) + " x" + launch.rounds + ", " + launch.seconds + "s");
        for (int round = 0; round < Math.Max(1, launch.rounds); round++) {
            foreach (var name in launch.cases) {
                bool sdk = !name.StartsWith("disabled", StringComparison.Ordinal);
                SwitchRoom(name.EndsWith("privacy", StringComparison.Ordinal) ? 2 : 0);
                string sessionId = null, startState = "disabled";
                if (sdk) {
                    var options = new RejourneyOptions { ApiUrl = endpoint, ObserveOnly = name == "telemetry" };
                    if (name == "replay-hires") { options.MaximumDimension = 1920; options.JpegQuality = 90; }
                    Rejourney.Init(key, options);
                    var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null;
                    sessionId = start.Result.SessionId; startState = start.Result.State.ToString();
                    Rejourney.SetMetadata("testRunId", runId); Rejourney.SetMetadata("benchmarkCase", name);
                    Rejourney.TrackScreen(names[room]);
                }
                running = true; scripted = true; stress = name.EndsWith("stress", StringComparison.Ordinal); startTime = Time.realtimeSinceStartup;
                yield return new WaitForSecondsRealtime(Math.Max(0, launch.warmupSeconds));
                object summary = null; string path = null;
                benchmark.Begin(name, runId + "-r" + round, launch.seconds, (reportPath, value) => { path = reportPath; summary = value; }, 10);
                while (benchmark.Active) yield return null;
                stress = false; scripted = false;
                string stopState = "disabled";
                if (sdk) { var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null; stopState = stop.Result.State.ToString(); }
                running = false;
                results.Add(new { round, name, startState, stopState, sessionId, report = path, summary });
                Debug.Log("[ArcadeLab] Benchmark result " + name + " r" + round + " start=" + startState + " stop=" + stopState + " " + Newtonsoft.Json.JsonConvert.SerializeObject(summary));
                yield return new WaitForSecondsRealtime(5);
            }
        }
        var suitePath = System.IO.Path.Combine(Application.persistentDataPath, "benchmark-suite-" + runId + ".json");
        System.IO.File.WriteAllText(suitePath, Newtonsoft.Json.JsonConvert.SerializeObject(new {
            runId, deviceModel = SystemInfo.deviceModel, graphicsApi = SystemInfo.graphicsDeviceType.ToString(), unityVersion = Application.unityVersion,
            development = Debug.isDebugBuild, targetFrameRate = Application.targetFrameRate, completedAt = DateTime.UtcNow.ToString("O"), results
        }, Newtonsoft.Json.Formatting.Indented));
        Debug.Log("[ArcadeLab] Benchmark suite complete: " + suitePath);
        message = "Benchmark suite complete: " + suitePath;
    }
    bool stress;
    double nextStressRequest;
    // Synthetic load for the stress cases: 60 logs/s, 10 custom events/s and one
    // ordinary woven UnityWebRequest every two seconds.
    void StressLoad()
    {
        Debug.Log("Synthetic stress log " + Time.frameCount);
        if (Time.frameCount % 6 == 0) Rejourney.LogEvent("stress_tick", new Dictionary<string, object> { ["frame"] = Time.frameCount, ["testRunId"] = runId });
        if (Time.realtimeSinceStartupAsDouble < nextStressRequest) return;
        nextStressRequest = Time.realtimeSinceStartupAsDouble + 2;
        StartCoroutine(StressRequest());
    }
    IEnumerator StressRequest()
    {
        using (var request = UnityWebRequest.Get("https://httpbin.org/get?synthetic=stress")) { request.timeout = 10; yield return request.SendWebRequest(); }
    }
    void BuildArena()
    {
        camera = Camera.main;
        if (!camera) camera = new GameObject("Arena Camera").AddComponent<Camera>();
        camera.tag = "MainCamera"; camera.transform.position = new Vector3(0, 10, -8); camera.transform.LookAt(Vector3.zero);
        camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.04f, .065f, .13f);
        var light = new GameObject("Arena Light").AddComponent<Light>(); light.type = LightType.Directional; light.transform.rotation = Quaternion.Euler(55, -30, 0);
        player = Primitive("Player", PrimitiveType.Sphere, new Vector3(0, .5f, 0), Color.cyan).transform;
        var floor = Primitive("Floor", PrimitiveType.Cube, new Vector3(0, -.2f, 0), new Color(.08f, .15f, .25f)); floor.transform.localScale = new Vector3(12, .2f, 12);
        Random.InitState(7321);
        for (int i = 0; i < 18; i++) {
            var coin = Primitive("Coin " + i, PrimitiveType.Cube, new Vector3(Random.Range(-4f, 4f), .5f, Random.Range(-4f, 4f)), Color.yellow).transform;
            coin.localScale = Vector3.one * .35f; coins.Add(coin);
        }
        var particles = new GameObject("Ambient Particles").AddComponent<ParticleSystem>();
        var main = particles.main; main.startColor = Color.cyan; main.startSpeed = .5f; main.startSize = .15f; main.maxParticles = 64;
        particles.transform.position = new Vector3(0, 1, 0);
        // The default particle material is built-in only and renders magenta under URP.
        var particleMaterial = Resources.Load<Material>(GraphicsSettings.currentRenderPipeline ? "ArcadeURP" : "ArcadeBuiltin");
        if (particleMaterial) particles.GetComponent<ParticleSystemRenderer>().material = new Material(particleMaterial) { color = Color.cyan };
    }
    static GameObject Primitive(string name, PrimitiveType type, Vector3 position, Color color)
    {
        var go = GameObject.CreatePrimitive(type); go.name = name; go.transform.position = position;
        var material = Resources.Load<Material>(GraphicsSettings.currentRenderPipeline ? "ArcadeURP" : "ArcadeBuiltin");
        go.GetComponent<Renderer>().material = material ? new Material(material) { color = color } : new Material(Shader.Find("Standard")) { color = color };
        return go;
    }
    void BuildInterface()
    {
        if (!FindFirstObjectByType<EventSystem>()) {
#if ENABLE_INPUT_SYSTEM
            var input = new GameObject("Input", typeof(EventSystem), typeof(InputSystemUIInputModule));
#else
            var input = new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule));
#endif
        }
        var canvas = new GameObject("Arcade UI", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
        var scale = canvas.GetComponent<CanvasScaler>(); scale.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; scale.referenceResolution = new Vector2(1080, 1920);
        for (int i = 0; i < names.Length; i++) {
            var panel = new GameObject(names[i], typeof(RectTransform)); panel.transform.SetParent(canvas.transform, false);
            var rect = (RectTransform)panel.transform; rect.anchorMin = new Vector2(.05f, .25f); rect.anchorMax = new Vector2(.95f, .65f); rect.offsetMin = rect.offsetMax = Vector2.zero;
            panel.AddComponent<RejourneyScreen>().ScreenName = names[i]; rooms.Add(panel); panel.SetActive(false);
        }
        Label(rooms[0].transform, "Move toward the gold cubes to collect them.", new Vector2(0, 200));
        AddButton(rooms[1].transform, "Synthetic purchase", new Vector2(0, 0), () => { Rejourney.LogEvent("purchase_completed", new Dictionary<string, object> { ["amount"] = 3, ["currency"] = "TEST", ["testRunId"] = runId }); message = "Synthetic purchase recorded."; });
        AddInput(rooms[2].transform, "Synthetic email", "synthetic@example.invalid", new Vector2(0, 140), false);
        AddInput(rooms[2].transform, "Password", "SYNTHETIC_PASSWORD_CANARY", new Vector2(0, 20), true);
        var secret = Label(rooms[2].transform, "MASK_CANARY_7321", new Vector2(0, -120)); secret.gameObject.AddComponent<RejourneyMask>(); sensitive = secret.transform;
        AddTmpInput(rooms[2].transform);
        BuildWorldPrivacy(); BuildToolkitPrivacy();
        AddButton(rooms[3].transform, "Run unwrapped HTTP scenarios", Vector2.zero, () => StartCoroutine(NetworkScenarios()));
        AddButton(rooms[4].transform, "Managed exception", new Vector2(0, 120), () => Rejourney.CaptureException(new InvalidOperationException("Synthetic Arcade Lab exception")));
        AddButton(rooms[4].transform, "Worker log error", Vector2.zero, () => Task.Run(() => Debug.LogError("Synthetic worker-thread error")));
        AddButton(rooms[4].transform, "Stall game loop 7 seconds", new Vector2(0, -120), () => { Rejourney.LogEvent("deliberate_game_loop_stall"); Thread.Sleep(7000); });
        // Unity catches the throw in the UI event and logs it as an unhandled exception.
        AddButton(rooms[4].transform, "Unhandled exception", new Vector2(0, -240), () => throw new InvalidOperationException("Synthetic unhandled exception"));
        AddButton(rooms[4].transform, "Unobserved task exception", new Vector2(0, -360), () => { Task.Run(ThrowFromAbandonedTask); StartCoroutine(CollectAbandonedTasks()); });
        AddButton(rooms[5].transform, "Toggle timeScale 0 / 1", new Vector2(0, 100), () => Time.timeScale = Time.timeScale == 0 ? 1 : 0);
        AddButton(rooms[5].transform, "Pause, wait 3 seconds, resume", new Vector2(0, -50), async () => { await Rejourney.PauseAsync(); await Task.Delay(3000); await Rejourney.ResumeAsync(); });
        AddButton(rooms[5].transform, "Load/unload additive scene", new Vector2(0, -180), () => StartCoroutine(AdditiveSceneScenario()));
        AddButton(rooms[6].transform, "Burst 5,000 logs", new Vector2(0, 100), () => { for (int i = 0; i < 5000; i++) Debug.Log("Synthetic stress " + i); });
        AddButton(rooms[6].transform, "Rotate screen", new Vector2(0, -50), () => Screen.orientation = Screen.width > Screen.height ? ScreenOrientation.Portrait : ScreenOrientation.LandscapeLeft);
        SwitchRoom(0);
    }
    void AddTmpInput(Transform parent)
    {
        var go = new GameObject("TMP privacy fixture", typeof(RectTransform), typeof(Image), typeof(TMP_InputField)); go.transform.SetParent(parent, false);
        var rect = (RectTransform)go.transform; rect.sizeDelta = new Vector2(850, 90); rect.anchoredPosition = new Vector2(0, -230);
        go.GetComponent<Image>().color = new Color(.15f, .20f, .28f);
        var textGo = new GameObject("Text", typeof(RectTransform), typeof(TextMeshProUGUI)); textGo.transform.SetParent(go.transform, false);
        var text = textGo.GetComponent<TextMeshProUGUI>(); text.font = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF"); text.fontSize = 28;
        var textRect = (RectTransform)textGo.transform; textRect.anchorMin = Vector2.zero; textRect.anchorMax = Vector2.one; textRect.offsetMin = textRect.offsetMax = Vector2.zero;
        var input = go.GetComponent<TMP_InputField>(); input.textViewport = rect; input.textComponent = text; input.text = "TMP_CANARY_7321";
    }
    void BuildWorldPrivacy()
    {
        var canvas = new GameObject("World-space masked panel", typeof(Canvas)); worldPrivacy = canvas;
        var component = canvas.GetComponent<Canvas>(); component.renderMode = RenderMode.WorldSpace; component.worldCamera = camera;
        canvas.transform.position = new Vector3(2, 1, 1); canvas.transform.rotation = camera.transform.rotation; canvas.transform.localScale = Vector3.one * .003f;
        var rect = (RectTransform)canvas.transform; rect.sizeDelta = new Vector2(850, 120);
        Label(canvas.transform, "WORLD_CANARY_7321", Vector2.zero); canvas.AddComponent<RejourneyMask>();
    }
    void BuildToolkitPrivacy()
    {
        var go = new GameObject("UI Toolkit privacy fixture"); toolkit = go.AddComponent<UIDocument>();
        toolkit.panelSettings = Resources.Load<PanelSettings>("ArcadePanel");
        var root = toolkit.rootVisualElement;
        root.style.position = Position.Absolute; root.style.left = Length.Percent(8); root.style.right = Length.Percent(8); root.style.top = Length.Percent(78);
        var input = new TextField("UI Toolkit synthetic input") { value = "TOOLKIT_CANARY_7321" };
        var password = new TextField("Always masked password") { value = "TOOLKIT_PASSWORD_7321", isPasswordField = true };
        input.style.fontSize = password.style.fontSize = 26; root.Add(input); root.Add(password);
    }
    Text Label(Transform parent, string content, Vector2 position)
    {
        var go = new GameObject(content, typeof(RectTransform), typeof(Text)); go.transform.SetParent(parent, false);
        var text = go.GetComponent<Text>(); text.font = font; text.fontSize = 30; text.alignment = TextAnchor.MiddleCenter; text.color = Color.white; text.text = content;
        var rect = (RectTransform)go.transform; rect.sizeDelta = new Vector2(850, 90); rect.anchoredPosition = position;
        return text;
    }
    void AddButton(Transform parent, string title, Vector2 position, UnityEngine.Events.UnityAction action)
    {
        var go = new GameObject(title, typeof(RectTransform), typeof(Image), typeof(Button)); go.transform.SetParent(parent, false);
        var rect = (RectTransform)go.transform; rect.sizeDelta = new Vector2(850, 95); rect.anchoredPosition = position;
        go.GetComponent<Image>().color = new Color(.12f, .24f, .40f, .98f); go.GetComponent<Button>().onClick.AddListener(action);
        Label(go.transform, title, Vector2.zero).raycastTarget = false;
        var target = go.AddComponent<RejourneyTarget>(); target.Identifier = title.Replace(" ", "_"); target.Actionable = true;
    }
    void AddInput(Transform parent, string label, string value, Vector2 position, bool password)
    {
        var go = new GameObject(label, typeof(RectTransform), typeof(Image), typeof(InputField)); go.transform.SetParent(parent, false);
        var rect = (RectTransform)go.transform; rect.sizeDelta = new Vector2(850, 90); rect.anchoredPosition = position;
        go.GetComponent<Image>().color = new Color(.15f, .20f, .28f);
        var text = Label(go.transform, "", Vector2.zero); text.supportRichText = false;
        var input = go.GetComponent<InputField>(); input.textComponent = text; input.inputType = password ? InputField.InputType.Password : InputField.InputType.Standard; input.text = value;
    }
    void SwitchRoom(int value)
    {
        room = value; for (int i = 0; i < rooms.Count; i++) rooms[i].SetActive(i == value); if (worldPrivacy) worldPrivacy.SetActive(value == 2); if (toolkit) toolkit.rootVisualElement.style.display = value == 2 ? DisplayStyle.Flex : DisplayStyle.None;
        if (!running) return;
        if (value != 0) LeaveArena(GameplayOutcome.Quit);
        Rejourney.TrackScreen(names[value]);
        if (value == 0) EnterArena();
    }
    // The arena is the game; the other rooms are menus. Marking play lets the replay
    // timeline and research exports separate gameplay input from interface use.
    void EnterArena() { if (!Rejourney.IsGameplayActive) Rejourney.StartGameplay("arena", new Dictionary<string, object> { ["testRunId"] = runId }); }
    void LeaveArena(string outcome) { if (Rejourney.IsGameplayActive) Rejourney.EndGameplay(outcome, new Dictionary<string, object> { ["score"] = score, ["testRunId"] = runId }); }
    void NextRound()
    {
        LeaveArena(GameplayOutcome.Completed);
        foreach (var coin in coins) { coin.position = new Vector3(Random.Range(-4f, 4f), .5f, Random.Range(-4f, 4f)); coin.gameObject.SetActive(true); }
        EnterArena();
    }
    void Update()
    {
        if (stress) StressLoad();
        if (sensitive) sensitive.localRotation = Quaternion.Euler(0, 0, Mathf.Sin(Time.unscaledTime) * 5);
        foreach (var coin in coins) if (coin && coin.gameObject.activeSelf) coin.Rotate(0, 45 * Time.unscaledDeltaTime, 0);
        if (!running || room != 0) return;
        if (scripted || benchmark.Active) player.position = new Vector3(Mathf.Sin((Time.realtimeSinceStartup - startTime) * .7f) * 3, .5f, Mathf.Cos((Time.realtimeSinceStartup - startTime) * .5f) * 3);
        bool pressed = false; Vector2 position = default;
#if ENABLE_INPUT_SYSTEM
        var pointer = Pointer.current;
        if (pointer != null) { pressed = pointer.press.isPressed; position = pointer.position.ReadValue(); }
#elif ENABLE_LEGACY_INPUT_MANAGER
        pressed = Input.GetMouseButton(0); position = Input.mousePosition;
        if (Input.touchCount > 0) { var touch = Input.GetTouch(0); pressed = touch.phase != TouchPhase.Ended && touch.phase != TouchPhase.Canceled; position = touch.position; }
#endif
        if (pressed) {
            var ray = camera.ScreenPointToRay(position);
            var plane = new Plane(Vector3.up, new Vector3(0, .5f, 0));
            if (plane.Raycast(ray, out var distance)) player.position = Vector3.MoveTowards(player.position, ray.GetPoint(distance), Time.unscaledDeltaTime * 5);
        }
        foreach (var coin in coins) if (coin.gameObject.activeSelf && Vector3.Distance(coin.position, player.position) < .65f) {
            coin.gameObject.SetActive(false); score++; Rejourney.LogEvent("coin_collected", new Dictionary<string, object> { ["score"] = score, ["testRunId"] = runId });
        }
        if (coins.TrueForAll(coin => !coin.gameObject.activeSelf)) NextRound();
    }
    async void Begin()
    {
        if (!consent) { message = "Consent is required."; return; }
        if (sdkDisabled) { running = true; message = "SDK disabled baseline."; return; }
        try {
            Rejourney.Init(key, new RejourneyOptions { ApiUrl = endpoint, ObserveOnly = telemetryOnly });
            var result = await Rejourney.StartAsync(); running = result.Success;
            Debug.Log("[ArcadeLab] Start: " + result.State + " session=" + result.SessionId + " error=" + result.Error);
            message = result.Error ?? result.State.ToString();
            Rejourney.SetUserIdentity("synthetic-player"); Rejourney.SetMetadata("testRunId", runId);
            Rejourney.TrackScreen(names[room]);
            if (room == 0) EnterArena();
        } catch (Exception error) { message = error.Message; }
    }
    IEnumerator NetworkScenarios()
    {
        string[] paths = { "get", "status/500", "redirect/2", "bytes/65536", "delay/5" };
        foreach (var path in paths) {
            using (var request = UnityWebRequest.Get("https://httpbin.org/" + path)) {
                request.timeout = path.StartsWith("delay") ? 1 : 15;
                yield return request.SendWebRequest();
                message = path + " → " + request.responseCode + " / " + request.result;
            }
        }
        using (var request = UnityWebRequest.Get("https://httpbin.org/delay/5")) {
            var pending = request.SendWebRequest(); yield return new WaitForSecondsRealtime(.2f); request.Abort(); yield return pending;
        }
        var http = HttpScenario(); while (!http.IsCompleted) yield return null;
        message = "Network scenarios completed. Verify telemetry and the build instrumentation report.";
    }
    async Task HttpScenario()
    {
        try {
            using (var client = new HttpClient(new HttpClientHandler(), true)) {
                client.Timeout = TimeSpan.FromSeconds(15);
                using (var response = await client.GetAsync("https://httpbin.org/get?synthetic=7321")) message = "HttpClient → " + response.StatusCode;
                using (var cancel = new CancellationTokenSource(100)) {
                    try { using (await client.GetAsync("https://httpbin.org/delay/5", cancel.Token)) { } }
                    catch (OperationCanceledException) { message = "HttpClient cancellation observed."; }
                }
            }
        } catch (Exception error) { message = "HTTP scenario: " + error.GetType().Name; }
    }
    static void ThrowFromAbandonedTask() => throw new FormatException("Synthetic unobserved task exception");
    // .NET reports a faulted task that nothing awaited only when the task is collected.
    IEnumerator CollectAbandonedTasks()
    {
        for (int i = 0; i < 3; i++) {
            yield return new WaitForSecondsRealtime(0.5f);
            GC.Collect(); GC.WaitForPendingFinalizers();
        }
    }
    IEnumerator AdditiveSceneScenario()
    {
        if (UnityEngine.SceneManagement.SceneManager.GetSceneByName("AdditiveFixture").isLoaded) yield break;
        using (Rejourney.BeginSceneLoad("AdditiveFixture"))
            yield return UnityEngine.SceneManagement.SceneManager.LoadSceneAsync("AdditiveFixture", UnityEngine.SceneManagement.LoadSceneMode.Additive);
        yield return new WaitForSecondsRealtime(2);
        yield return UnityEngine.SceneManagement.SceneManager.UnloadSceneAsync("AdditiveFixture");
    }
    IEnumerator ScriptedRun()
    {
        if (scripted) yield break;
        scripted = true; startTime = Time.realtimeSinceStartup;
        Rejourney.LogEvent("scripted_run_start", new Dictionary<string, object> { ["testRunId"] = runId });
        for (int i = 0; i < names.Length; i++) { SwitchRoom(i); yield return new WaitForSecondsRealtime(3); }
        SwitchRoom(2); yield return new WaitForSecondsRealtime(4);
        Screen.orientation = ScreenOrientation.LandscapeLeft; yield return new WaitForSecondsRealtime(3);
        Screen.orientation = ScreenOrientation.Portrait; yield return new WaitForSecondsRealtime(3);
        yield return AdditiveSceneScenario();
        yield return NetworkScenarios();
        Rejourney.CaptureException(new InvalidOperationException("Synthetic scripted handled exception"));
        var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
        yield return new WaitForSecondsRealtime(3);
        var resume = Rejourney.ResumeAsync(); while (!resume.IsCompleted) yield return null;
        // A second gameplay interval that ends with an explicit outcome.
        SwitchRoom(0); yield return new WaitForSecondsRealtime(3);
        LeaveArena(GameplayOutcome.Completed);
        Rejourney.LogEvent("scripted_run_complete", new Dictionary<string, object> { ["testRunId"] = runId });
        var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
        message = "Run " + runId + " complete. Flush: " + flush.Result.State;
        scripted = false;
    }
    void OnGUI()
    {
        float scale = Mathf.Max(1f, Screen.width / 600f); GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1));
        GUILayout.BeginArea(new Rect(12, 12, Screen.width / scale - 24, Screen.height / scale - 24));
        GUILayout.Label("REJOURNEY ARCADE LAB  |  score " + score);
        GUILayout.Label("Run: " + runId);
        if (!running) {
            GUILayout.Label("Cloud public key"); key = GUILayout.TextField(key);
            consent = GUILayout.Toggle(consent, "I consent to this synthetic validation session");
            sdkDisabled = GUILayout.Toggle(sdkDisabled, "SDK disabled performance baseline");
            telemetryOnly = GUILayout.Toggle(telemetryOnly, "Telemetry-only performance comparison");
            if (GUILayout.Button("Start")) Begin();
        }
        GUILayout.Label("State: " + Rejourney.State + " · Session: " + (Rejourney.CurrentSessionId ?? "—"));
        GUILayout.Label("FPS policy " + Rejourney.Settings.FramesPerSecond + " · submitted " + Rejourney.Health.FramesCaptured + " · native accepted " + Rejourney.Health.NativeFramesAccepted + " · backlog skips " + (Rejourney.Health.FramesSkippedBackpressure + Rejourney.Health.NativeFramesSkippedBackpressure) + " · privacy skips " + Rejourney.Health.FramesSkippedPrivacy);
        GUILayout.Label("Events queued " + Rejourney.Health.PendingEvents + " · dropped " + Rejourney.Health.EventsDropped + " · capture " + Rejourney.Health.LastCaptureMilliseconds.ToString("F1") + "ms");
        GUILayout.Label(message);
        if (running) {
            GUILayout.BeginHorizontal(); for (int i = 0; i < names.Length; i++) if (GUILayout.Button(names[i])) SwitchRoom(i); GUILayout.EndHorizontal();
            if (GUILayout.Button("Run deterministic scenario")) StartCoroutine(ScriptedRun());
            if (!benchmark.Active && GUILayout.Button("Measure matched 30-minute arena run")) {
                SwitchRoom(0); startTime = Time.realtimeSinceStartup;
                benchmark.Begin(sdkDisabled ? "disabled" : telemetryOnly ? "telemetry-only" : "replay", runId, 1800, path => message = "Benchmark saved: " + path);
            }
            if (GUILayout.Button("Flush")) Flush();
            if (GUILayout.Button("Stop")) Stop();
            if (Debug.isDebugBuild && room == 4) {
                if (GUILayout.Button("FATAL native crash (restart app afterward)")) DiagnosticFaults.NativeCrash();
                if (GUILayout.Button("Native UI-thread stall 7 seconds")) DiagnosticFaults.NativeUiStall();
            }
            if (GUILayout.Button("Open cloud session") && Rejourney.CurrentSessionId != null) Application.OpenURL("https://rejourney.co/dashboard/sessions/" + Rejourney.CurrentSessionId);
        }
        GUILayout.EndArea();
    }
    async void Flush() { var result = await Rejourney.FlushAsync(); message = "Flush: " + result.State; }
    async void Stop() { var result = await Rejourney.StopAsync(); running = false; message = "Stop: " + result.State; }
}
