using System;
using System.Diagnostics;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine.Networking;
using UnityEngine.Scripting;

namespace RejourneySDK
{
    [Preserve]
    public static class NetworkCapture
    {
        static readonly ConditionalWeakTable<UnityWebRequest, Observation> requests = new ConditionalWeakTable<UnityWebRequest, Observation>();
        sealed class Observation
        {
            public readonly Stopwatch Clock = Stopwatch.StartNew();
            public readonly RejourneyBehaviour.CollectionContext Context = Rejourney.Host?.CaptureContext();
            public long Started => Context?.Timestamp ?? 0;
            public string Url, Method;
            public int Reported;
        }
        public static UnityWebRequestAsyncOperation SendWebRequest(UnityWebRequest request)
        {
            // Do not change null receivers, exceptions, or the returned AsyncOperation.
            if (request == null) throw new NullReferenceException();
            var observation = new Observation { Url = request.url, Method = request.method };
            var operation = request.SendWebRequest();
            requests.Remove(request); requests.Add(request, observation);
            operation.completed += _ => Report(request, observation, false);
            if (operation.isDone) Report(request, observation, false);
            return operation;
        }
        public static void Dispose(UnityWebRequest request)
        {
            if (request == null) throw new NullReferenceException();
            if (requests.TryGetValue(request, out var observation)) Report(request, observation, !request.isDone);
            request.Dispose();
        }
        public static void Dispose(IDisposable value)
        {
            if (value is UnityWebRequest request) Dispose(request);
            else value.Dispose();
        }
        static void Report(UnityWebRequest request, Observation observation, bool cancelled)
        {
            if (Interlocked.Exchange(ref observation.Reported, 1) != 0) return;
            try {
                observation.Context?.Network(new NetworkRequestInfo {
                    Url = observation.Url, Method = observation.Method, StatusCode = (int)request.responseCode,
                    StartedAtUnixMilliseconds = observation.Started, DurationMilliseconds = observation.Clock.Elapsed.TotalMilliseconds,
                    RequestBytes = (long)request.uploadedBytes, ResponseBytes = (long)request.downloadedBytes,
                    Error = request.error, Cancelled = cancelled || request.error == "Request aborted"
                });
            } catch { /* Instrumentation must not throw into game code or a completion handler. */ }
            requests.Remove(request);
        }
        public static HttpClient CreateHttpClient() => CreateHttpClient(new HttpClientHandler(), true);
        public static HttpClient CreateHttpClient(HttpMessageHandler handler) => CreateHttpClient(handler, true);
        public static HttpClient CreateHttpClient(HttpMessageHandler handler, bool disposeHandler)
        {
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            return new HttpClient(new RecordingHandler(handler), disposeHandler);
        }
        sealed class RecordingHandler : DelegatingHandler
        {
            public RecordingHandler(HttpMessageHandler inner) : base(inner) { }
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                var context = Rejourney.Host?.CaptureContext(); var clock = Stopwatch.StartNew();
                HttpResponseMessage response = null; Exception failure = null;
                try { response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false); return response; }
                catch (Exception error) { failure = error; throw; }
                finally {
                    try { context?.Network(new NetworkRequestInfo {
                        Method = request.Method.Method, Url = request.RequestUri?.ToString(), StatusCode = response == null ? 0 : (int)response.StatusCode,
                        StartedAtUnixMilliseconds = context.Timestamp, DurationMilliseconds = clock.Elapsed.TotalMilliseconds,
                        RequestBytes = request.Content?.Headers.ContentLength, ResponseBytes = response?.Content?.Headers.ContentLength,
                        Cancelled = failure is OperationCanceledException, Error = failure?.GetType().Name
                    }); } catch { }
                }
            }
        }
        internal static bool TrySanitize(string input, string endpoint, out string sanitized)
        {
            sanitized = null;
            if (!Uri.TryCreate(input, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https")) return false;
            if (Uri.TryCreate(endpoint, UriKind.Absolute, out var own) && string.Equals(uri.Host, own.Host, StringComparison.OrdinalIgnoreCase)) return false;
            // Drop credentials, query values, and fragments. Never collect headers or bodies.
            sanitized = uri.GetLeftPart(UriPartial.Authority);
            var clean = new UriBuilder(uri) { UserName = "", Password = "", Query = "", Fragment = "" };
            sanitized = clean.Uri.GetLeftPart(UriPartial.Path);
            return true;
        }
    }
    [AttributeUsage(AttributeTargets.Assembly | AttributeTargets.Class | AttributeTargets.Method)]
    public sealed class RejourneyNetworkExcludeAttribute : Attribute { }
}
