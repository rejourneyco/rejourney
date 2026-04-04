Query 1 — Backed-up sessions that still have “valid” screenshot rows in DB
Use this when you care about current DB state (sessions not fully purged). “Valid” here means ready screenshot artifacts with non-zero size and frame count:


SELECT
  COUNT(*) AS backed_up_sessions,
  COUNT(sc.session_id) AS backed_up_with_valid_screenshot_artifacts,
  COUNT(*) - COUNT(sc.session_id) AS backed_up_without_such_screenshot_rows
FROM session_backup_log bl
LEFT JOIN (
  SELECT DISTINCT session_id
  FROM recording_artifacts
  WHERE kind = 'screenshots'
    AND status = 'ready'
    AND COALESCE(size_bytes, 0) > 0
    AND COALESCE(frame_count, 0) > 0
) sc ON sc.session_id = bl.session_id;
