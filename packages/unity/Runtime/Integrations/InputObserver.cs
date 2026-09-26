using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;
namespace RejourneySDK
{
    internal static class InputObserver
    {
        internal static Action<RejourneyBehaviour> Modern;
        internal static Func<Vector2, string> ActionableTarget;
        static readonly Dictionary<int, long> motionTimes = new Dictionary<int, long>();
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Reset() { Modern = null; ActionableTarget = null; motionTimes.Clear(); }
        internal static void Collect(RejourneyBehaviour host)
        {
            if (Modern != null) { Modern(host); return; }
#if ENABLE_LEGACY_INPUT_MANAGER
            for (int i = 0; i < Input.touchCount; i++) {
                var touch = Input.GetTouch(i);
                if (touch.phase == UnityEngine.TouchPhase.Began || touch.phase == UnityEngine.TouchPhase.Moved || touch.phase == UnityEngine.TouchPhase.Ended || touch.phase == UnityEngine.TouchPhase.Canceled)
                    Touch(host, touch.fingerId, touch.position, touch.phase.ToString());
            }
#endif
        }
        internal static void Touch(RejourneyBehaviour host, int id, Vector2 position, string phase)
        {
            long timestamp = host.Timestamp;
            if (phase == "Moved") {
                if (motionTimes.TryGetValue(id, out var last) && timestamp - last < 50) return;
                if (motionTimes.Count >= 32) motionTimes.Clear();
                motionTimes[id] = timestamp;
            } else if (phase == "Ended" || phase == "Canceled") motionTimes.Remove(id);
            var target = phase == "Began" ? ActionableTarget?.Invoke(position) ?? ToolkitTarget(position) : null;
            float x = position.x, y = Screen.height - position.y;
            host.TouchEvent(x, y, phase, id, host.Options.DetectRageTaps && target != null, target, host.Timestamp);
        }
        static string ToolkitTarget(Vector2 position)
        {
            var docs = UnityEngine.Object.FindObjectsByType<UIDocument>(FindObjectsSortMode.None);
            if (docs.Length > 32) return null;
            foreach (var doc in docs) {
                if (!doc.isActiveAndEnabled || doc.rootVisualElement?.panel == null || doc.panelSettings?.targetTexture) continue;
                var point = RuntimePanelUtils.ScreenToPanel(doc.rootVisualElement.panel, new Vector2(position.x, Screen.height - position.y));
                var element = doc.rootVisualElement.panel.Pick(point);
                string identifier = null;
                for (int depth = 0; element != null && depth < 32; depth++, element = element.parent) {
                    if (element is TextField || element.ClassListContains("rejourney-mask")) return null;
                    if (element is Button && element.enabledInHierarchy && !string.IsNullOrEmpty(element.name)) identifier = element.name;
                }
                if (identifier != null) return identifier;
            }
            return null;
        }
    }
}
