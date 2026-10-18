using System.Collections.Generic;
using UnityEngine;

namespace ChronoHeist
{
    public enum CameraViewMode
    {
        TacticalFollow = 0,   // 46 deg pitch, 18 deg yaw, dynamic aim look-ahead
        CloseAction = 1,      // 26 deg 3rd-person shoulder angle + automatic wall X-ray cutaway
        OverwatchBlueprint = 2 // 66 deg high-command view of all 5 zones
    }

    public class ChronoCameraRig : MonoBehaviour
    {
        public static ChronoCameraRig Instance { get; private set; }

        public Camera TargetCamera;
        public Transform FollowTarget;
        public Vector3 AimDirection = Vector3.forward;
        public bool IsArmoryTurntableMode = true;
        public int FocusedPodIndex = 0; // 0..3 when inspecting L1..L4 crew slots in Armory

        public CameraViewMode CurrentMode = CameraViewMode.TacticalFollow;

        private Vector3 _currentVelocity;
        private float _orbitAngle = 0f;
        private float _punchIntensity = 0f;
        private float _hitStopTimer = 0f;
        private float _rewindBlend = 0f;

        private readonly List<Renderer> _fadedWallRenderers = new List<Renderer>();
        private readonly Dictionary<Renderer, Color> _originalWallColors = new Dictionary<Renderer, Color>();

        private void Awake()
        {
            Instance = this;
            if (TargetCamera == null)
            {
                TargetCamera = GetComponent<Camera>();
                if (TargetCamera == null) TargetCamera = Camera.main;
            }
        }

        public string CycleCameraMode()
        {
            int next = ((int)CurrentMode + 1) % 3;
            CurrentMode = (CameraViewMode)next;
            WebGLBridge.TriggerSynth("ui_cam_switch", 0.7f);
            return GetModeLabel();
        }

        public string GetModeLabel()
        {
            switch (CurrentMode)
            {
                case CameraViewMode.TacticalFollow: return "TACTICAL 46°";
                case CameraViewMode.CloseAction: return "ACTION 3RD-PERSON";
                case CameraViewMode.OverwatchBlueprint: return "OVERWATCH 66°";
                default: return "TACTICAL 46°";
            }
        }

        public void TriggerImpactPunch(float intensity = 1.0f, float hitStopDuration = 0.11f)
        {
            _punchIntensity = Mathf.Clamp(intensity, 0.2f, 2.0f);
            _hitStopTimer = Mathf.Max(_hitStopTimer, hitStopDuration);
            Time.timeScale = 0.15f;
        }

        public void TriggerRewindSweep()
        {
            _rewindBlend = 1.0f;
        }

        private void Update()
        {
            // Restore hit-stop using unscaledDeltaTime
            if (_hitStopTimer > 0f)
            {
                _hitStopTimer -= Time.unscaledDeltaTime;
                if (_hitStopTimer <= 0f)
                {
                    Time.timeScale = 1.0f;
                }
            }

            if (Input.GetKeyDown(KeyCode.V))
            {
                CycleCameraMode();
            }

            if (_punchIntensity > 0f)
            {
                _punchIntensity = Mathf.MoveTowards(_punchIntensity, 0f, Time.unscaledDeltaTime * 4.5f);
            }

            if (_rewindBlend > 0f)
            {
                _rewindBlend = Mathf.MoveTowards(_rewindBlend, 0f, Time.unscaledDeltaTime * 1.6f);
            }
        }

        private void LateUpdate()
        {
            if (TargetCamera == null) return;

            RestoreFadedWalls();

            if (IsArmoryTurntableMode)
            {
                UpdateArmoryTurntableCamera();
                return;
            }

            if (FollowTarget == null) return;

            Vector3 targetPos = FollowTarget.position;
            Vector3 desiredOffset;
            Quaternion desiredRot;
            float baseFov;

            switch (CurrentMode)
            {
                case CameraViewMode.CloseAction:
                    // Low 26 deg over-the-shoulder action angle
                    desiredRot = Quaternion.Euler(26f, 10f, _punchIntensity * 3.5f);
                    desiredOffset = desiredRot * new Vector3(0f, 0f, -9.2f);
                    targetPos += AimDirection * 1.8f + Vector3.up * 1.25f;
                    baseFov = 54f;
                    break;

                case CameraViewMode.OverwatchBlueprint:
                    // High-altitude 66 deg tactical blueprint view of all 5 zones
                    desiredRot = Quaternion.Euler(66f, 0f, _punchIntensity * 2.0f);
                    desiredOffset = desiredRot * new Vector3(0f, 0f, -24.5f);
                    targetPos = Vector3.Lerp(targetPos, new Vector3(0f, 0f, -0.5f), 0.65f);
                    baseFov = 50f;
                    break;

                case CameraViewMode.TacticalFollow:
                default:
                    // Signature 46 deg tilted isometric angle with 16 deg yaw + dynamic look-ahead
                    desiredRot = Quaternion.Euler(46f, 16f, _punchIntensity * 3.2f);
                    desiredOffset = desiredRot * new Vector3(0f, 0f, -15.8f);
                    targetPos += AimDirection * 2.6f + Vector3.up * 0.6f;
                    baseFov = 45f;
                    break;
            }

            if (_rewindBlend > 0f)
            {
                // Pull camera along high arc during 0.7s loop tape-rewind
                desiredOffset += new Vector3(0f, _rewindBlend * 6.5f, -_rewindBlend * 4.0f);
            }

            Vector3 finalCamPos = targetPos + desiredOffset;
            transform.position = Vector3.SmoothDamp(transform.position, finalCamPos, ref _currentVelocity, 0.08f, 100f, Time.unscaledDeltaTime);
            transform.rotation = Quaternion.Slerp(transform.rotation, desiredRot, Time.unscaledDeltaTime * 14f);
            TargetCamera.fieldOfView = Mathf.Lerp(TargetCamera.fieldOfView, baseFov - (_punchIntensity * 5.5f), Time.unscaledDeltaTime * 16f);

            // Automatic Wall Cutaway in Close Action & Tactical Follow modes so walls never block the operative
            if (CurrentMode != CameraViewMode.OverwatchBlueprint)
            {
                ApplyWallCutaway(transform.position, FollowTarget.position + Vector3.up * 1.1f);
            }
        }

        private void UpdateArmoryTurntableCamera()
        {
            _orbitAngle += Time.unscaledDeltaTime * 8.0f;
            float podX = -4.5f + (FocusedPodIndex * 3.0f);
            Vector3 podTarget = new Vector3(podX, 1.35f, -8.5f);

            float swayX = Mathf.Sin(_orbitAngle * Mathf.Deg2Rad) * 1.35f;
            Vector3 camPos = new Vector3(podX + swayX, 2.35f, -13.6f);
            Quaternion camRot = Quaternion.LookRotation((podTarget - camPos).normalized, Vector3.up);

            transform.position = Vector3.SmoothDamp(transform.position, camPos, ref _currentVelocity, 0.14f, 60f, Time.unscaledDeltaTime);
            transform.rotation = Quaternion.Slerp(transform.rotation, camRot, Time.unscaledDeltaTime * 10f);
            TargetCamera.fieldOfView = Mathf.Lerp(TargetCamera.fieldOfView, 38f, Time.unscaledDeltaTime * 10f);
        }

        private void ApplyWallCutaway(Vector3 camPos, Vector3 playerPos)
        {
            Vector3 dir = playerPos - camPos;
            float dist = dir.magnitude;
            if (dist <= 0.5f) return;

            RaycastHit[] hits = Physics.SphereCastAll(camPos, 0.65f, dir.normalized, dist - 0.8f);
            for (int i = 0; i < hits.Length; i++)
            {
                GameObject hitObj = hits[i].collider.gameObject;
                if (hitObj.name.StartsWith("Wall_") || hitObj.name.StartsWith("Column_"))
                {
                    Renderer[] rends = hitObj.GetComponentsInChildren<Renderer>();
                    for (int r = 0; r < rends.Length; r++)
                    {
                        Renderer rend = rends[r];
                        if (rend == null || rend.material == null) continue;
                        if (!_originalWallColors.ContainsKey(rend))
                        {
                            _originalWallColors[rend] = rend.material.color;
                        }
                        Color c = _originalWallColors[rend];
                        c.a = 0.22f;
                        rend.material.color = c;
                        if (!_fadedWallRenderers.Contains(rend))
                        {
                            _fadedWallRenderers.Add(rend);
                        }
                    }
                }
            }
        }

        private void RestoreFadedWalls()
        {
            for (int i = 0; i < _fadedWallRenderers.Count; i++)
            {
                Renderer rend = _fadedWallRenderers[i];
                if (rend != null && _originalWallColors.TryGetValue(rend, out Color orig))
                {
                    rend.material.color = orig;
                }
            }
            _fadedWallRenderers.Clear();
        }
    }
}
