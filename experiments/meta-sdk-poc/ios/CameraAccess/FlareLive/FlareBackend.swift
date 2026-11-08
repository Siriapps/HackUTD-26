/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * The Avon Night Shift endpoints the glasses use:
 *   POST /api/gemini/glasses — mints a Live session (token + setup frame + event context + sessionId).
 *   POST /api/notify — confirm/escalate tool calls to ops (same body as the web /field page).
 *   POST /api/live/events — Live Incident Response ingest: transcript finals, runbook updates,
 *     notes, session lifecycle.  Media (audio/video) is never sent here.
 */

import Foundation

struct FlareBackend: Sendable {
  struct Incident: Sendable, Equatable {
    let summary: String
    let outcome: String
    let source: String
  }

  struct Grant: Sendable {
    let token: String
    let model: String
    let wsUrl: String
    /// Server-built `setup` object, sent verbatim.
    let setupJSON: Data
    /// The Event as the server returned it, echoed back to /api/notify.
    let eventJSON: Data
    let eventId: String
    let eventLabel: String
    let folder: String
    let incidents: [Incident]
    let videoFps: Double
    let videoMaxEdge: Int
    let videoJpegQuality: Double
    let inputSampleRate: Int
    let outputSampleRate: Int
    /// Stable session identifier for the whole glasses call (survives Gemini reconnects).
    let sessionId: String
    /// Whether simulation / classroom demo mode is active.
    let simulation: Bool

    var socketURL: URL? { URL(string: "\(wsUrl)?access_token=\(token)") }
  }

  struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  let baseURL: URL
  let deviceToken: String

  init?(server: String, deviceToken: String) {
    let trimmed = server.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: trimmed), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil else { return nil }
    self.baseURL = url
    self.deviceToken = deviceToken.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func startSession(eventId: String, folder: String, simulation: Bool) async throws -> Grant {
    var body: [String: Any] = ["eventId": eventId, "simulation": simulation]
    if !folder.isEmpty { body["folder"] = folder }
    let json = try await post("api/gemini/glasses", body: body)
    guard json["ok"] as? Bool == true else {
      throw Failure(message: json["reason"] as? String ?? "the server refused the session")
    }
    guard
      let token = json["token"] as? String, let wsUrl = json["wsUrl"] as? String, let setup = json["setup"],
      let event = json["event"] as? [String: Any]
    else { throw Failure(message: "the server's session response is missing token, wsUrl, setup or event") }
    let media = json["media"] as? [String: Any] ?? [:]
    let incidents = (json["incidents"] as? [[String: Any]] ?? []).map {
      Incident(summary: $0["summary"] as? String ?? "", outcome: $0["outcome"] as? String ?? "", source: $0["source"] as? String ?? "")
    }
    return Grant(
      token: token,
      model: json["model"] as? String ?? "",
      wsUrl: wsUrl,
      setupJSON: try JSONSerialization.data(withJSONObject: setup),
      eventJSON: try JSONSerialization.data(withJSONObject: event),
      eventId: event["id"] as? String ?? eventId,
      eventLabel: json["eventLabel"] as? String ?? eventId,
      folder: json["folder"] as? String ?? folder,
      incidents: incidents,
      videoFps: media["videoFps"] as? Double ?? 1,
      videoMaxEdge: media["videoMaxEdge"] as? Int ?? 768,
      videoJpegQuality: media["videoJpegQuality"] as? Double ?? 0.6,
      inputSampleRate: media["inputSampleRate"] as? Int ?? 16000,
      outputSampleRate: media["outputSampleRate"] as? Int ?? 24000,
      sessionId: json["sessionId"] as? String ?? UUID().uuidString,
      simulation: json["simulation"] as? Bool ?? simulation
    )
  }

  /// Same body the web page's `notifyOps` sends. Returns the server's one-line outcome.
  func notify(grant: Grant, kind: String, note: String?) async -> (ok: Bool, message: String) {
    do {
      let event = try JSONSerialization.jsonObject(with: grant.eventJSON)
      var body: [String: Any] = ["event": event, "folder": grant.folder, "kind": kind]
      if let note, !note.isEmpty { body["note"] = note }
      let json = try await post("api/notify", body: body, allowErrorStatus: true)
      let message = json["message"] as? String ?? json["reason"] as? String ?? ""
      return (json["ok"] as? Bool ?? false, message)
    } catch {
      return (false, error.localizedDescription)
    }
  }

  /**
   Publish a structured Live Incident event to POST /api/live/events.
   Failures are fire-and-forget: the caller logs the outcome but never drops the Gemini socket.
   The event must include sessionId, folder, eventId — these are taken from the Grant.
   */
  @discardableResult
  func publish(grant: Grant, liveEvent: [String: Any]) async -> Bool {
    do {
      let json = try await post("api/live/events", body: liveEvent, allowErrorStatus: true)
      return json["ok"] as? Bool ?? false
    } catch {
      return false
    }
  }

  private func post(_ path: String, body: [String: Any], allowErrorStatus: Bool = false) async throws -> [String: Any] {
    var req = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: 20)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    if !deviceToken.isEmpty { req.setValue(deviceToken, forHTTPHeaderField: "x-field-token") }
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: req)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      throw Failure(message: "\(path): HTTP \(status), not JSON. Is the server URL the Next.js app?")
    }
    if !allowErrorStatus, !(200..<300).contains(status), json["ok"] as? Bool != false {
      throw Failure(message: "\(path): HTTP \(status)")
    }
    return json
  }
}
