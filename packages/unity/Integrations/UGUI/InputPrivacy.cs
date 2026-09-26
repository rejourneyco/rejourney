using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using UnityEngine.EventSystems;
using UnityEngine.Scripting;
// Nothing references this adapter; it installs itself. Without AlwaysLinkAssembly,
// UnityLinker drops the whole assembly and uGUI/TMP inputs lose their masks.
[assembly: AlwaysLinkAssembly]
namespace RejourneySDK
{
    [Preserve]
    sealed class InputPrivacy : IRejourneyPrivacyProvider, IRejourneyUguiPrivacy
    {
        [Preserve, RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install() { PrivacyRegistry.Register(new InputPrivacy()); InputObserver.ActionableTarget = ResolveTarget; }
        // Touches are resolved on the Unity thread; reuse the raycast buffers.
        static readonly List<RaycastResult> hits = new List<RaycastResult>();
        static PointerEventData pointer;
        static EventSystem pointerSystem;
        static string ResolveTarget(Vector2 point)
        {
            var system = EventSystem.current; if (!system) return null;
            if (pointer == null || pointerSystem != system) { pointer = new PointerEventData(system); pointerSystem = system; }
            pointer.Reset(); pointer.position = point;
            hits.Clear();
            system.RaycastAll(pointer, hits);
            if (hits.Count == 0) return null;
            var go = hits[0].gameObject;
            hits.Clear();
            if (go.GetComponentInParent<RejourneyMask>()) return null;
            for (var parent = go.transform; parent; parent = parent.parent) if (PrivacyRegistry.Targets.Contains(parent.gameObject)) return null;
            var target = go.GetComponentInParent<RejourneyTarget>();
            return target && target.Actionable && go.GetComponentInParent<Selectable>() ? target.Identifier : null;
        }
        public bool CollectMasks(List<Rect> masks, bool maskAll)
        {
            var legacy = Object.FindObjectsByType<InputField>(FindObjectsSortMode.None);
            var tmp = Object.FindObjectsByType<TMP_InputField>(FindObjectsSortMode.None);
            if (legacy.Length + tmp.Length > 256) return false;
            foreach (var field in legacy) {
                if (!field.isActiveAndEnabled || (!maskAll && field.inputType != InputField.InputType.Password)) continue;
                if (!PrivacyRegistry.TryBounds(field.gameObject, out var rect)) return false;
                masks.Add(rect);
            }
            foreach (var field in tmp) {
                if (!field.isActiveAndEnabled || (!maskAll && field.inputType != TMP_InputField.InputType.Password)) continue;
                if (!PrivacyRegistry.TryBounds(field.gameObject, out var rect)) return false;
                masks.Add(rect);
            }
            return true;
        }
    }
}
