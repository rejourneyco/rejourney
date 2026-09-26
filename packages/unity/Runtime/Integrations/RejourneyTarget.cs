using UnityEngine;
namespace RejourneySDK
{
    [DisallowMultipleComponent]
    public sealed class RejourneyTarget : MonoBehaviour
    {
        [Tooltip("A static, non-sensitive identifier. Never include player-entered text.")]
        public string Identifier;
        public bool Actionable;
    }
}
