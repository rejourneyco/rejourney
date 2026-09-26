using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace RejourneySDK
{
    public interface IRejourneyPrivacyProvider
    {
        // Rectangles use top-left pixel coordinates in the current Unity viewport.
        // Return false if geometry cannot be established; the entire frame is dropped.
        bool CollectMasks(List<Rect> masks, bool maskAllTextInputs);
    }
    // Implemented by the optional uGUI adapter, which owns InputField/TMP geometry.
    internal interface IRejourneyUguiPrivacy { }
    public static class PrivacyRegistry
    {
        internal static readonly HashSet<GameObject> Targets = new HashSet<GameObject>();
        static readonly List<IRejourneyPrivacyProvider> providers = new List<IRejourneyPrivacyProvider>();
        public static void Register(IRejourneyPrivacyProvider provider) { if (provider != null && !providers.Contains(provider)) providers.Add(provider); }
        public static void Unregister(IRejourneyPrivacyProvider provider) => providers.Remove(provider);
        internal static void Reset() { Targets.Clear(); providers.Clear(); }
        internal static void Add(GameObject target) { if (target) Targets.Add(target); }
        internal static void Remove(GameObject target) { if (target) Targets.Remove(target); }
        internal static bool Collect(List<Rect> masks, bool allText)
        {
            masks.Clear();
            try {
                // Re-register scene masks when domain and scene reload are disabled.
                foreach (var mask in UnityEngine.Object.FindObjectsByType<RejourneyMask>(FindObjectsSortMode.None))
                    if (mask.isActiveAndEnabled) Targets.Add(mask.gameObject);
                Targets.RemoveWhere(target => !target);
                foreach (var target in Targets) {
                    if (!target || !target.activeInHierarchy) continue;
                    if (!TryBounds(target, out var rect)) return false;
                    masks.Add(rect);
                }
                bool ugui = false;
                foreach (var provider in providers) {
                    ugui |= provider is IRejourneyUguiPrivacy;
                    if (!provider.CollectMasks(masks, allText)) return false;
                }
                if (!ugui && UnguardedUguiInputs()) {
                    if (!warnedUgui) { warnedUgui = true; Debug.LogWarning("[Rejourney] uGUI privacy adapter missing from this build; frames with active input fields are dropped."); }
                    return false;
                }
                var documents = UnityEngine.Object.FindObjectsByType<UIDocument>(FindObjectsSortMode.None);
                if (documents.Length > 32) return false;
                foreach (var doc in documents) {
                    if (!doc.isActiveAndEnabled || doc.rootVisualElement?.panel == null) continue;
                    // A texture-backed panel can be drawn anywhere in a world scene.
                    // Its on-screen geometry cannot be inferred from panel coordinates.
                    if (doc.panelSettings && (doc.panelSettings.targetTexture || doc.panelSettings.targetDisplay != 0)) return false;
                    var panelBounds = doc.rootVisualElement.panel.visualTree.worldBound;
                    if (panelBounds.width <= 0 || panelBounds.height <= 0) return false;
                    bool safe = true; int visited = 0;
                    doc.rootVisualElement.Query<TextField>().ForEach(field => {
                        if (++visited > 256) { safe = false; return; }
                        if ((!allText && !field.isPasswordField) || field.resolvedStyle.display == DisplayStyle.None || field.resolvedStyle.visibility == Visibility.Hidden) return;
                        var r = field.worldBound;
                        masks.Add(new Rect((r.x - panelBounds.x) * Screen.width / panelBounds.width, (r.y - panelBounds.y) * Screen.height / panelBounds.height,
                            r.width * Screen.width / panelBounds.width, r.height * Screen.height / panelBounds.height));
                    });
                    doc.rootVisualElement.Query(className: "rejourney-mask").ForEach(element => {
                        if (++visited > 256) { safe = false; return; }
                        var r = element.worldBound;
                        masks.Add(new Rect((r.x - panelBounds.x) * Screen.width / panelBounds.width, (r.y - panelBounds.y) * Screen.height / panelBounds.height,
                            r.width * Screen.width / panelBounds.width, r.height * Screen.height / panelBounds.height));
                    });
                    if (!safe) return false;
                }
                if (masks.Count > 128) return false;
                for (int i = 0; i < masks.Count; i++) {
                    var rect = masks[i];
                    if (!Finite(rect.x) || !Finite(rect.y) || !Finite(rect.width) || !Finite(rect.height) || rect.width < 0 || rect.height < 0) return false;
                    // Pad to prevent filtering and antialiasing leaking edge pixels.
                    masks[i] = Rect.MinMaxRect(rect.xMin - 3, rect.yMin - 3, rect.xMax + 3, rect.yMax + 3);
                }
                return true;
            } catch { return false; }
        }
        static bool Finite(float x) => !float.IsNaN(x) && !float.IsInfinity(x);
        static Type[] uguiInputTypes;
        static bool warnedUgui;
        // A stripped or deleted uGUI adapter must not turn into unmasked inputs.
        // Types the game never uses are stripped too, so this costs nothing then.
        static bool UnguardedUguiInputs()
        {
            if (uguiInputTypes == null) uguiInputTypes = new[] {
                Type.GetType("UnityEngine.UI.InputField, UnityEngine.UI"), Type.GetType("TMPro.TMP_InputField, Unity.TextMeshPro")
            };
            foreach (var type in uguiInputTypes) {
                if (type == null) continue;
                foreach (var found in UnityEngine.Object.FindObjectsByType(type, FindObjectsSortMode.None))
                    if (found is Behaviour behaviour && behaviour.isActiveAndEnabled) return true;
            }
            return false;
        }
        // Main-thread scratch buffers: bounds run for every mask on every capture.
        static readonly List<RectTransform> rectBuffer = new List<RectTransform>(64);
        static readonly List<Renderer> rendererBuffer = new List<Renderer>(32);
        static readonly Vector3[] four = new Vector3[4];
        static Vector3[] corners = new Vector3[256];
        internal static bool TryBounds(GameObject target, out Rect result)
        {
            result = default;
            var rt = target.GetComponent<RectTransform>();
            int count;
            Camera camera;
            bool worldSpace;
            if (rt) {
                var canvas = target.GetComponentInParent<Canvas>();
                if (!canvas) return false;
                camera = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
                worldSpace = canvas.renderMode == RenderMode.WorldSpace;
                if (canvas.renderMode == RenderMode.ScreenSpaceCamera && !camera) return false;
                target.GetComponentsInChildren(rectBuffer);
                if (rectBuffer.Count > 256) { rectBuffer.Clear(); return false; }
                if (corners.Length < rectBuffer.Count * 4) corners = new Vector3[rectBuffer.Count * 4];
                count = 0;
                foreach (var child in rectBuffer) {
                    if (!child.gameObject.activeInHierarchy) continue;
                    child.GetWorldCorners(four); Array.Copy(four, 0, corners, count, 4); count += 4;
                }
                rectBuffer.Clear();
                if (count == 0) return false;
                if (!worldSpace) for (int i = 0; i < count; i++) {
                    if (camera && camera.WorldToScreenPoint(corners[i]).z <= camera.nearClipPlane) return false;
                    corners[i] = RectTransformUtility.WorldToScreenPoint(camera, corners[i]);
                }
            } else {
                worldSpace = true;
                target.GetComponentsInChildren(rendererBuffer);
                if (rendererBuffer.Count == 0 || rendererBuffer.Count > 128) { rendererBuffer.Clear(); return false; }
                var bounds = rendererBuffer[0].bounds; foreach (var renderer in rendererBuffer) bounds.Encapsulate(renderer.bounds);
                rendererBuffer.Clear();
                for (int i = 0; i < 8; i++) {
                    var point = bounds.center + Vector3.Scale(bounds.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    corners[i] = point;
                }
                count = 8;
            }
            if (worldSpace) return ProjectWorldBounds(target, corners, count, out result);
            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            for (int i = 0; i < count; i++) { var p = corners[i]; minX = Mathf.Min(minX, p.x); maxX = Mathf.Max(maxX, p.x); minY = Mathf.Min(minY, p.y); maxY = Mathf.Max(maxY, p.y); }
            result = Rect.MinMaxRect(minX, Screen.height - maxY, maxX, Screen.height - minY);
            return true;
        }
        static bool ProjectWorldBounds(GameObject target, Vector3[] corners, int count, out Rect result)
        {
            result = default;
            // A world-space object can appear in multiple split-screen cameras.
            // Camera.main alone would leave its other appearances unredacted.
            var cameras = Camera.allCameras;
            if (cameras.Length > 16) return false;
            bool found = false;
            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            foreach (var camera in cameras) {
                if (!camera.isActiveAndEnabled) continue;
                // Render textures may be displayed on arbitrary geometry. There
                // is no safe screen mapping for those surfaces in this adapter.
                if (camera.targetTexture || camera.targetDisplay != 0) return false;
                found = true;
                for (int i = 0; i < count; i++) {
                    var p = camera.WorldToScreenPoint(corners[i]);
                    if (p.z <= camera.nearClipPlane) return false;
                    minX = Mathf.Min(minX, p.x); maxX = Mathf.Max(maxX, p.x);
                    minY = Mathf.Min(minY, p.y); maxY = Mathf.Max(maxY, p.y);
                }
            }
            if (!found) return false;
            result = Rect.MinMaxRect(minX, Screen.height - maxY, maxX, Screen.height - minY);
            return true;
        }
    }
}
