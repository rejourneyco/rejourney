using System;
using System.Collections;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace RejourneySDK.Tests
{
    public class RuntimeContractTests
    {
        [TestCase("https://user:password@example.com/path?token=secret#private", "https://example.com/path")]
        [TestCase("http://example.com:8080/a?q=x", "http://example.com:8080/a")]
        public void NetworkSanitizationRemovesCredentialsQueryAndFragment(string input, string expected)
        {
            Assert.That(NetworkCapture.TrySanitize(input, "https://api.rejourney.co", out var actual), Is.True);
            Assert.That(actual, Is.EqualTo(expected));
        }
        [TestCase("https://api.rejourney.co/api/sdk/config")]
        [TestCase("file:///private/credentials")]
        public void InternalAndNonHttpRequestsAreExcluded(string input) => Assert.That(NetworkCapture.TrySanitize(input, "https://api.rejourney.co", out _), Is.False);
        [Test] public void OptionsAreCopiedAndClamped()
        {
            var original = new RejourneyOptions { FramesPerSecond = 20, MaximumDimension = 0 };
            var normalized = original.Validated();
            Assert.That(normalized.FramesPerSecond, Is.EqualTo(3));
            Assert.That(normalized.MaximumDimension, Is.EqualTo(240));
            Assert.That(original.FramesPerSecond, Is.EqualTo(20));
        }
        [Test] public void InvalidEndpointFailsBeforeInitialization() => Assert.Throws<ArgumentException>(() => new RejourneyOptions { ApiUrl = "http://localhost" }.Validated());
        [Test] public void MissingMaskGeometryFailsClosed()
        {
            var go = new GameObject("Sensitive");
            try { Rejourney.Mask(go); Assert.That(PrivacyRegistry.Collect(new System.Collections.Generic.List<Rect>(), true), Is.False); }
            finally { Rejourney.Unmask(go); UnityEngine.Object.DestroyImmediate(go); }
        }
        [Test] public void WorldMaskCoversBothSplitScreenViewsAndRejectsTextureProjection()
        {
            var left = new GameObject("left camera").AddComponent<Camera>();
            var right = new GameObject("right camera").AddComponent<Camera>();
            var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var texture = new RenderTexture(64, 64, 0);
            try {
                left.transform.position = right.transform.position = new Vector3(0, 0, -10);
                left.rect = new Rect(0, 0, .5f, 1); right.rect = new Rect(.5f, 0, .5f, 1);
                Assert.That(PrivacyRegistry.TryBounds(target, out var bounds), Is.True);
                Assert.That(bounds.Contains(new Vector2(Screen.width * .25f, Screen.height * .5f)), Is.True);
                Assert.That(bounds.Contains(new Vector2(Screen.width * .75f, Screen.height * .5f)), Is.True);
                right.targetTexture = texture;
                Assert.That(PrivacyRegistry.TryBounds(target, out _), Is.False);
            } finally {
                UnityEngine.Object.DestroyImmediate(left.gameObject); UnityEngine.Object.DestroyImmediate(right.gameObject);
                UnityEngine.Object.DestroyImmediate(target); UnityEngine.Object.DestroyImmediate(texture);
            }
        }
        sealed class UguiProvider : IRejourneyPrivacyProvider, IRejourneyUguiPrivacy
        {
            public bool CollectMasks(System.Collections.Generic.List<Rect> masks, bool maskAllTextInputs) => true;
        }
        [Test] public void MissingUguiAdapterFailsClosedForActiveInputs()
        {
            var inputType = Type.GetType("UnityEngine.UI.InputField, UnityEngine.UI");
            if (inputType == null) {
                // Projects without uGUI (the package's optional-adapter-free install):
                // the guard has nothing to protect and must never drop frames.
                Assert.That(PrivacyRegistry.Collect(new System.Collections.Generic.List<Rect>(), true), Is.True);
                return;
            }
            // Isolate from an adapter registered earlier in this domain.
            var field = typeof(PrivacyRegistry).GetField("providers", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            var registered = (System.Collections.Generic.List<IRejourneyPrivacyProvider>)field.GetValue(null);
            var saved = registered.ToArray();
            var go = new GameObject("Synthetic input", typeof(RectTransform));
            try {
                registered.Clear();
                go.AddComponent(inputType);
                var masks = new System.Collections.Generic.List<Rect>();
                Assert.That(PrivacyRegistry.Collect(masks, true), Is.False, "An active uGUI input without its adapter must drop the frame.");
                PrivacyRegistry.Register(new UguiProvider());
                Assert.That(PrivacyRegistry.Collect(masks, true), Is.True);
            } finally {
                registered.Clear(); registered.AddRange(saved);
                UnityEngine.Object.DestroyImmediate(go);
            }
        }
        [Test] public void LinkerReceivesPackagePreservationRules()
        {
            // UnityLinker ignores link.xml inside packages; the processor must hand it over.
            var path = new RejourneySDK.Editor.RejourneyLinkerProcessor().GenerateAdditionalLinkXmlFile(null, null);
            var xml = System.IO.File.ReadAllText(path);
            StringAssert.Contains("fullname=\"Rejourney.Runtime\" preserve=\"all\"", xml);
            StringAssert.Contains("fullname=\"Rejourney.UGUI\" preserve=\"all\"", xml);
            StringAssert.Contains("fullname=\"Rejourney.InputSystem\" preserve=\"all\"", xml);
        }
        [Test] public void WireFormatIgnoresGlobalNewtonsoftSettings()
        {
            // Games commonly install global settings for their own saves or networking.
            var previous = Newtonsoft.Json.JsonConvert.DefaultSettings;
            Newtonsoft.Json.JsonConvert.DefaultSettings = () => new Newtonsoft.Json.JsonSerializerSettings {
                ContractResolver = new Newtonsoft.Json.Serialization.DefaultContractResolver { NamingStrategy = new Newtonsoft.Json.Serialization.SnakeCaseNamingStrategy() },
                NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore
            };
            try {
                var json = NativeBridge.Serialize(7, "configure", new { publicKey = "rj_key", observeOnly = false, userId = (string)null });
                Assert.That(json, Is.EqualTo("{\"id\":7,\"command\":\"configure\",\"payload\":{\"publicKey\":\"rj_key\",\"observeOnly\":false,\"userId\":null}}"));
                Assert.That(SdkJson.ToObject(new { statusCode = 200 }).ToString(Newtonsoft.Json.Formatting.None), Is.EqualTo("{\"statusCode\":200}"));
            } finally { Newtonsoft.Json.JsonConvert.DefaultSettings = previous; }
        }
        sealed class Handler : HttpMessageHandler
        {
            public bool Disposed; public CancellationToken Token;
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { Token = token; return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted)); }
            protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
        }
        [Test] public async Task HttpClientPreservesCustomHandlerAndDisposalOwnership()
        {
            var handler = new Handler();
            using (var client = NetworkCapture.CreateHttpClient(handler, false))
            using (var response = await client.GetAsync("https://synthetic.example/test")) Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Accepted));
            Assert.That(handler.Disposed, Is.False);
            using (NetworkCapture.CreateHttpClient(handler, true)) { }
            Assert.That(handler.Disposed, Is.True);
        }
        [Test] public void HttpNullSemantics() { Assert.Throws<ArgumentNullException>(() => NetworkCapture.CreateHttpClient(null)); Assert.Throws<NullReferenceException>(() => NetworkCapture.SendWebRequest(null)); }
        [UnityTest] public IEnumerator EditorInitNeverStartsRecording()
        {
            Rejourney.Init("rj_synthetic_test");
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Ready));
            var task = Rejourney.StartAsync();
            while (!task.IsCompleted) yield return null;
            Assert.That(task.Result.State, Is.EqualTo(CaptureState.Unsupported));
            var stop = Rejourney.StopAsync();
            while (!stop.IsCompleted) yield return null;
            Assert.That(Rejourney.CurrentSessionId, Is.Null);
            UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject);
        }
    }
}
