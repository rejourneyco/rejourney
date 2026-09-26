using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Scripting;
[assembly: AlwaysLinkAssembly]
namespace RejourneySDK
{
    [Preserve]
    static class ModernInput
    {
        [Preserve, RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install() { InputObserver.Modern = Collect; }
        static void Collect(RejourneyBehaviour host)
        {
            var screen = Touchscreen.current;
            if (screen == null) return;
            foreach (var touch in screen.touches) {
                if (touch.press.wasPressedThisFrame) InputObserver.Touch(host, touch.touchId.ReadValue(), touch.position.ReadValue(), "Began");
                else if (touch.press.isPressed && touch.delta.ReadValue() != Vector2.zero) InputObserver.Touch(host, touch.touchId.ReadValue(), touch.position.ReadValue(), "Moved");
                if (touch.press.wasReleasedThisFrame) InputObserver.Touch(host, touch.touchId.ReadValue(), touch.position.ReadValue(), "Ended");
            }
        }
    }
}
