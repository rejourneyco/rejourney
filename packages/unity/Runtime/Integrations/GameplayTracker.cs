using System;
using System.Collections.Generic;
using System.Threading;
using UnityEngine;

namespace RejourneySDK
{
    /// <summary>
    /// Conventional outcomes for <see cref="Rejourney.EndGameplay"/>. Any short string is
    /// accepted; <see cref="Superseded"/> and <see cref="SessionEnd"/> are written by the SDK.
    /// </summary>
    public static class GameplayOutcome
    {
        public const string Completed = "completed";
        public const string Failed = "failed";
        public const string Quit = "quit";
        public const string Abandoned = "abandoned";
        public const string Ended = "ended";
        /// <summary>A new segment started before this one ended.</summary>
        public const string Superseded = "superseded";
        /// <summary>The recording session stopped while the segment was still active.</summary>
        public const string SessionEnd = "session_end";
    }

    /// <summary>
    /// One active gameplay segment (a level, match, round or run) at a time. The state is
    /// independent of the recording session. Each session learns about segments through
    /// start and end markers (type "gameplay", phase "start" | "end", shared gameplayId);
    /// touches recorded during play carry the gameplayId and are never rage-eligible.
    ///
    /// Markers cannot be written while the SDK is not collecting: in the background, while
    /// paused, or while native replaces the session. The host remembers which segment its
    /// session was last told about, and <see cref="Sync"/> writes any missed end or start,
    /// with its original time, as soon as collection resumes. A game that ends play in its
    /// own pause handler therefore keeps its end marker whatever the callback order.
    /// </summary>
    internal static class GameplayTracker
    {
        internal sealed class Segment
        {
            internal string Id, Name;
            internal IDictionary<string, object> Properties;
            internal long StartedAt;
            // Orders segments against sessions exactly; timestamps can tie within a millisecond.
            internal long Sequence;
            // Set once, when the segment ends, for a session that has not yet received its end.
            internal string EndOutcome;
            internal IDictionary<string, object> EndProperties;
            internal long EndedAt;
        }
        static readonly object gate = new object();
        // Read without the lock on every touch; changed only under the lock.
        static Segment active;
        static long sequence;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Reset() { lock (gate) Volatile.Write(ref active, null); }

        internal static string ActiveId => Volatile.Read(ref active)?.Id;
        internal static long Now() => SdkClock.Now();

        internal static string Start(string name, IDictionary<string, object> properties)
        {
            var next = new Segment {
                Id = Guid.NewGuid().ToString("N"), Name = Clip(name, 128),
                Properties = properties == null ? null : new Dictionary<string, object>(properties), StartedAt = Now(),
                Sequence = Interlocked.Increment(ref sequence)
            };
            lock (gate) {
                var previous = active;
                if (previous != null) MarkEnded(previous, GameplayOutcome.Superseded, null, next.StartedAt);
                Volatile.Write(ref active, next);
            }
            // A reference check, like LogEvent's Host?.: callable from any thread, and a
            // destroyed host no longer admits events.
            Rejourney.Host?.SyncGameplay();
            return next.Id;
        }

        /// <summary>Ends the active segment; when <paramref name="onlyId"/> is set, only that one.</summary>
        internal static bool End(string outcome, IDictionary<string, object> properties, string onlyId = null)
        {
            lock (gate) {
                var ended = active;
                if (ended == null || (onlyId != null && ended.Id != onlyId)) return false;
                MarkEnded(ended, Clip(outcome, 64) ?? GameplayOutcome.Ended, properties, Now());
                Volatile.Write(ref active, null);
            }
            Rejourney.Host?.SyncGameplay();
            return true;
        }

        static void MarkEnded(Segment segment, string outcome, IDictionary<string, object> properties, long at)
        {
            segment.EndOutcome = outcome;
            segment.EndProperties = properties == null ? null : new Dictionary<string, object>(properties);
            segment.EndedAt = at;
        }

        /// <summary>
        /// Brings the host's session up to date with the active segment: an end for the segment
        /// it was told about, if that one has ended, then a start for the active one. Runs when
        /// markers change and whenever collection resumes; a marker the host cannot write yet
        /// is retried on the next call.
        /// </summary>
        internal static void Sync(RejourneyBehaviour host)
        {
            if (!host.Collecting) return;
            lock (gate) {
                var current = active;
                var told = host.SessionSegment;
                if (ReferenceEquals(told, current)) return;
                if (told != null) {
                    if (!host.GameplayEvent("end", told, told.EndOutcome ?? GameplayOutcome.Ended, told.EndProperties, false,
                        told.EndedAt > 0 ? told.EndedAt : Now())) return;
                    host.SessionSegment = null;
                }
                if (current == null) return;
                // A segment that began before this session is continued, marked at the session start.
                bool continued = current.Sequence < host.SessionSequence;
                if (host.GameplayEvent("start", current, null, null, continued, continued ? Now() : current.StartedAt))
                    host.SessionSegment = current;
            }
        }

        /// <summary>The host's session changed (or ended): the new one has been told nothing.</summary>
        internal static void ResetSession(RejourneyBehaviour host)
        {
            lock (gate) { host.SessionSegment = null; host.SessionSequence = Interlocked.Increment(ref sequence); }
        }

        /// <summary>The session is stopping; its interval ends here while the segment stays active.</summary>
        internal static void MarkSessionEnd(RejourneyBehaviour host)
        {
            Sync(host);
            lock (gate) {
                var told = host.SessionSegment;
                if (told == null) return;
                if (host.GameplayEvent("end", told, GameplayOutcome.SessionEnd, null, false, Now())) host.SessionSegment = null;
            }
        }

        static string Clip(string text, int max)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            text = text.Trim();
            return text.Length <= max ? text : text.Substring(0, max);
        }

        internal sealed class Scope : IDisposable
        {
            readonly string id;
            int disposed;
            internal Scope(string id) { this.id = id; }
            public void Dispose()
            {
                if (Interlocked.Exchange(ref disposed, 1) == 0) End(GameplayOutcome.Completed, null, id);
            }
        }
    }
}
