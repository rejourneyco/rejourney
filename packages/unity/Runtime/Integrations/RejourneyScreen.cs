using UnityEngine;
namespace RejourneySDK
{
    [DisallowMultipleComponent]
    public sealed class RejourneyScreen : MonoBehaviour
    {
        public string ScreenName;
        void OnEnable() => Rejourney.TrackScreen(string.IsNullOrEmpty(ScreenName) ? gameObject.name : ScreenName);
    }
}
