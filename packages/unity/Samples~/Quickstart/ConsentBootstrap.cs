using UnityEngine;
using RejourneySDK;
public sealed class ConsentBootstrap : MonoBehaviour
{
    [Tooltip("Use your cloud project's public key, never an account credential.")]
    public string PublicProjectKey;
    void Awake() => Rejourney.Init(PublicProjectKey);
    // Connect to your app's consent button. Init alone does not collect a session.
    public async void OnConsentGranted() { var result = await Rejourney.StartAsync(); Debug.Log("Rejourney: " + result.State); }
    public async void OnConsentWithdrawn() { await Rejourney.StopAsync(); }
}
