using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RejourneySDK
{
    // The wire format must not follow a game's global JsonConvert.DefaultSettings
    // (naming strategies, null handling, converters): native bridges and ingestion
    // expect fixed keys. JsonSerializer.Create, unlike CreateDefault and the
    // JsonConvert helpers, ignores those globals entirely.
    internal static class SdkJson
    {
        internal static readonly JsonSerializer Serializer = JsonSerializer.Create(new JsonSerializerSettings { ContractResolver = new Newtonsoft.Json.Serialization.DefaultContractResolver() });
        internal static string Serialize(object value)
        {
            var text = new System.IO.StringWriter(new System.Text.StringBuilder(256), System.Globalization.CultureInfo.InvariantCulture);
            using (var writer = new JsonTextWriter(text) { Formatting = Formatting.None }) Serializer.Serialize(writer, value);
            return text.ToString();
        }
        internal static JObject ToObject(object value) => JObject.FromObject(value, Serializer);
    }
    // Wall-clock Unix milliseconds for every event and frame, as in native and the other
    // SDKs. A Stopwatch stops while the device sleeps, so a start epoch plus elapsed time
    // falls behind after a locked screen: events land in the past and native rejects every
    // frame of the session that follows.
    internal static class SdkClock
    {
        // Tests move the wall clock to model a device that slept.
        internal static long OffsetMilliseconds;
        internal static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + OffsetMilliseconds;
    }
    /// <summary>A payload that is already a serialized JSON value.</summary>
    internal sealed class RawJson
    {
        internal readonly string Json;
        internal RawJson(string json) { Json = json; }
    }
    internal interface IRejourneyBridge : IDisposable
    {
        Task<JObject> Request(string command, object payload = null);
        void Poll();
        void Frame(byte[] bytes, string session, long timestamp);
    }
    internal sealed class NativeBridge : IRejourneyBridge
    {
        sealed class Pending
        {
            internal readonly TaskCompletionSource<JObject> Completion = new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
            internal readonly long Created = Stopwatch.GetTimestamp();
        }
        readonly object gate = new object();
        readonly Dictionary<int, Pending> pending = new Dictionary<int, Pending>();
        readonly ConcurrentQueue<Tuple<int, string>> outgoing = new ConcurrentQueue<Tuple<int, string>>();
        bool disposed;
        int sequence;
        long nextExpiry;
#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void rj_unity_request(string json);
        [DllImport("__Internal")] static extern IntPtr rj_unity_poll();
        [DllImport("__Internal")] static extern void rj_unity_free(IntPtr ptr);
        [DllImport("__Internal")] static extern void rj_unity_frame(byte[] bytes, int count, string session, long timestamp);
#elif UNITY_ANDROID && !UNITY_EDITOR
        AndroidJavaClass bridge;
        AndroidJavaObject activity;
        // AndroidJavaClass.CallStatic builds the signature and looks the method up through
        // Java reflection on every call, boxes its arguments, and logs two warnings for each
        // byte[] it is given, which here means every frame. The three bridge methods are
        // resolved once and called through JNI directly.
        IntPtr bridgeClass, requestMethod, pollMethod, frameMethod;
        readonly jvalue[] requestArguments = new jvalue[2], frameArguments = new jvalue[3], noArguments = new jvalue[0];
        bool direct;
        static IntPtr Method(IntPtr type, string name, string signature)
        {
            IntPtr method = IntPtr.Zero;
            try { method = AndroidJNI.GetStaticMethodID(type, name, signature); } catch { }
            ClearJavaException();
            return method;
        }
        static bool ClearJavaException()
        {
            IntPtr pending = AndroidJNI.ExceptionOccurred();
            if (pending == IntPtr.Zero) return false;
            AndroidJNI.ExceptionClear(); AndroidJNI.DeleteLocalRef(pending);
            return true;
        }
        void SendRequest(string json)
        {
            if (!direct) { bridge.CallStatic("request", activity, json); return; }
            IntPtr text = AndroidJNI.NewString(json);
            try {
                requestArguments[0].l = activity.GetRawObject(); requestArguments[1].l = text;
                AndroidJNI.CallStaticVoidMethod(bridgeClass, requestMethod, requestArguments);
                if (ClearJavaException()) throw new InvalidOperationException("Rejourney native request failed.");
            } finally { AndroidJNI.DeleteLocalRef(text); }
        }
        string ReceiveResponse()
        {
            if (!direct) return bridge.CallStatic<string>("poll");
            string json = AndroidJNI.CallStaticStringMethod(bridgeClass, pollMethod, noArguments);
            return ClearJavaException() ? null : json;
        }
        void SendFrame(byte[] bytes, string session, long timestamp)
        {
            if (!direct) { bridge.CallStatic("frame", bytes, session, timestamp); return; }
            IntPtr array = AndroidJNI.ToByteArray(bytes), text = AndroidJNI.NewString(session);
            try {
                frameArguments[0].l = array; frameArguments[1].l = text; frameArguments[2].j = timestamp;
                AndroidJNI.CallStaticVoidMethod(bridgeClass, frameMethod, frameArguments);
                ClearJavaException();
            } finally { AndroidJNI.DeleteLocalRef(array); AndroidJNI.DeleteLocalRef(text); }
        }
#endif
        internal NativeBridge()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            bridge = new AndroidJavaClass("com.rejourney.RejourneyUnity");
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                activity = player.GetStatic<AndroidJavaObject>("currentActivity");
            bridgeClass = bridge.GetRawClass();
            requestMethod = Method(bridgeClass, "request", "(Landroid/app/Activity;Ljava/lang/String;)V");
            pollMethod = Method(bridgeClass, "poll", "()Ljava/lang/String;");
            frameMethod = Method(bridgeClass, "frame", "([BLjava/lang/String;J)V");
            direct = requestMethod != IntPtr.Zero && pollMethod != IntPtr.Zero && frameMethod != IntPtr.Zero;
#endif
        }
        public Task<JObject> Request(string command, object payload = null)
        {
            lock (gate) {
                if (disposed) return Task.FromException<JObject>(new ObjectDisposedException(nameof(NativeBridge)));
                if (pending.Count >= 128) return Task.FromException<JObject>(new InvalidOperationException("Rejourney native command queue is full."));
                var id = ++sequence;
                var json = Serialize(id, command, payload);
                if (json.Length > 512 * 1024) return Task.FromException<JObject>(new ArgumentException("Rejourney command exceeds 512 KB."));
                var source = new Pending(); pending.Add(id, source);
#if (UNITY_IOS || UNITY_ANDROID) && !UNITY_EDITOR
                outgoing.Enqueue(Tuple.Create(id, json));
#else
                pending.Remove(id);
                source.Completion.SetResult(SdkJson.ToObject(new { success = false, error = "unsupported_editor", state = "unsupported" }));
#endif
                return source.Completion.Task;
            }
        }
        // Commands without a payload (the status poll, once a second) and pre-serialized
        // payloads are written directly; only real payload objects go through the serializer.
        internal static string Serialize(int id, string command, object payload) => payload is RawJson raw
            ? "{\"id\":" + id + ",\"command\":" + JsonConvert.ToString(command) + ",\"payload\":" + raw.Json + "}"
            : payload == null ? "{\"id\":" + id + ",\"command\":" + JsonConvert.ToString(command) + ",\"payload\":null}"
            : SdkJson.Serialize(new { id, command, payload });
        public void Poll()
        {
            // Empty JNI calls allocate their argument/return plumbing. Ordinary
            // frames with no command in flight need no native polling at all.
            lock (gate) { if (disposed || pending.Count == 0) return; }
            // JNI, native dispatch and callbacks only run from the Unity thread.
            // Producers may enqueue from HttpClient continuations or game workers.
            for (int i = 0; i < 64 && outgoing.TryDequeue(out var request); i++) {
                lock (gate) { if (!pending.ContainsKey(request.Item1)) continue; }
                try {
#if UNITY_IOS && !UNITY_EDITOR
                    rj_unity_request(request.Item2);
#elif UNITY_ANDROID && !UNITY_EDITOR
                    SendRequest(request.Item2);
#endif
                } catch (Exception error) { lock (gate) { if (pending.TryGetValue(request.Item1, out var item)) { pending.Remove(request.Item1); item.Completion.TrySetException(error); } } }
            }
            for (int i = 0; i < 64; i++) {
                string json = null;
#if UNITY_IOS && !UNITY_EDITOR
                var ptr = rj_unity_poll();
                if (ptr != IntPtr.Zero) { try { json = Marshal.PtrToStringAnsi(ptr); } finally { rj_unity_free(ptr); } }
#elif UNITY_ANDROID && !UNITY_EDITOR
                json = ReceiveResponse();
#endif
                if (string.IsNullOrEmpty(json)) break;
                try {
                    var response = JObject.Parse(json);
                    int id = response.Value<int>("id");
                    lock (gate) { if (pending.TryGetValue(id, out var item)) { pending.Remove(id); item.Completion.TrySetResult(response); } }
                } catch (JsonException) { /* Malformed native response expires its request below. */ }
            }
            long now = Stopwatch.GetTimestamp();
            if (now < nextExpiry) return;
            nextExpiry = now + Stopwatch.Frequency;
            lock (gate) {
                if (pending.Count == 0) return;
                var expired = new List<int>();
                foreach (var item in pending) if (now - item.Value.Created > 120 * Stopwatch.Frequency) expired.Add(item.Key);
                foreach (var id in expired) { var item = pending[id]; pending.Remove(id); item.Completion.TrySetException(new TimeoutException("Rejourney native command timed out.")); }
            }
        }
        // Called on the Unity thread. Both platforms copy the bytes before returning.
        public void Frame(byte[] bytes, string session, long timestamp)
        {
#if UNITY_IOS && !UNITY_EDITOR
            rj_unity_frame(bytes, bytes.Length, session, timestamp);
#elif UNITY_ANDROID && !UNITY_EDITOR
            SendFrame(bytes, session, timestamp);
#endif
        }
        public void Dispose()
        {
            lock (gate) {
                disposed = true;
                foreach (var item in pending.Values) item.Completion.TrySetCanceled();
                pending.Clear();
                while (outgoing.TryDequeue(out _)) { }
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            bridge?.Dispose(); activity?.Dispose();
#endif
        }
    }
}
