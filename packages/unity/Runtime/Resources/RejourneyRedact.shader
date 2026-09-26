Shader "Hidden/Rejourney/Redact" {
 Properties { _MainTex ("Frame", 2D) = "white" {} }
 SubShader { Cull Off ZWrite Off ZTest Always
  Pass {
   CGPROGRAM
   #pragma vertex vert_img
   #pragma fragment frag
   #pragma target 3.0
   #include "UnityCG.cginc"
   sampler2D _MainTex;
   float4 _Masks[128];
   int _MaskCount;
   // CaptureScreenshotIntoRenderTexture stores the back buffer in native row order,
   // which is upside down on APIs whose UV origin is the top (Metal, Vulkan).
   float _FlipSource;
   fixed4 frag(v2f_img i) : SV_Target {
    // The destination is upright; masks use top-left screen coordinates.
    float2 screen = float2(i.uv.x, 1.0 - i.uv.y);
    for (int n = 0; n < _MaskCount; n++) {
     float4 r = _Masks[n];
     if (screen.x >= r.x && screen.y >= r.y && screen.x <= r.z && screen.y <= r.w) {
      // Same visible gray in gamma and linear projects (linear writes are sRGB-encoded).
      #ifdef UNITY_COLORSPACE_GAMMA
      return fixed4(0.12, 0.12, 0.12, 1);
      #else
      return fixed4(GammaToLinearSpace(float3(0.12, 0.12, 0.12)), 1);
      #endif
     }
    }
    return tex2D(_MainTex, _FlipSource > 0.5 ? float2(i.uv.x, 1.0 - i.uv.y) : i.uv);
   }
   ENDCG
  }
 }
}
