using UnityEngine;
namespace RejourneySDK
{
    [DisallowMultipleComponent]
    public sealed class RejourneyMask : MonoBehaviour
    {
        void OnEnable() => Rejourney.Mask(gameObject);
        void OnDisable() => Rejourney.Unmask(gameObject);
    }
}
