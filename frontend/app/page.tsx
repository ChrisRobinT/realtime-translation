"use client";

import { useEffect, useRef, useState } from "react";
// @ts-ignore
import SimplePeer from "simple-peer";
import { io, Socket } from "socket.io-client";
import {
  Mic,
  Globe,
  Users,
  Wifi,
  WifiOff,
  Phone,
  PhoneOff,
  Volume2,
  Loader2,
  CheckCircle,
  Moon,
  Sun,
  Lightbulb,
} from "lucide-react";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [clientId, setClientId] = useState("");
  const [recording, setRecording] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [sourceLang, setSourceLang] = useState("et");
  const [targetLang, setTargetLang] = useState("en");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isRecording, setIsRecording] = useState(false);
  const [peerIsRecording, setPeerIsRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const unlockAudio = () => {
    if (!audioUnlocked) {
      // Play silent audio to unlock
      const silentAudio = new Audio(
        "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAQKAAAAAAAAA4SG6YdQAAAAAAD/+xDEAAADSAZAAP4QMACEAD9wAAAPb+SgaUoIOFJPPPPPPPPPP"
      );
      silentAudio
        .play()
        .then(() => {
          setAudioUnlocked(true);
          console.log("✅ Audio unlocked!");
        })
        .catch(() => {});
    }
  };
  const [translations, setTranslations] = useState<
    Array<{
      original: string;
      translated: string;
      sourceLang: string;
      targetLang: string;
      timestamp: Date;
    }>
  >([]);

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme =
      (localStorage.getItem("theme") as "light" | "dark") || "light";
    setTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  useEffect(() => {
    setClientId(Math.random().toString(36).substring(7));
  }, []);

  const connectToRoom = async () => {
    if (!roomId) {
      alert("Please enter a room ID");
      return;
    }

    unlockAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      console.log("Got microphone access");
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone");
      return;
    }

    const socket = io("https://realtime-translation-production.up.railway.app");
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to signaling server");
      setConnected(true);
      socket.emit("join-room", { roomId, clientId });
    });

    socket.on("initiate-call", (data: { peerId: string }) => {
      console.log("Server told us to initiate call with:", data.peerId);
      createPeer(true, data.peerId);
    });

    socket.on("peer-joined", (data: { peerId: string }) => {
      console.log("Peer joined (we are NOT initiating):", data.peerId);
    });

    socket.on("offer", (data: { from: string; offer: any }) => {
      console.log("Received offer from:", data.from);
      createPeer(false, data.from, data.offer);
    });

    socket.on("answer", (data: { from: string; answer: any }) => {
      console.log("Received answer from:", data.from);
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.signal(data.answer);
      }
    });

    socket.on("ice-candidate", (data: { from: string; candidate: any }) => {
      console.log("Received ICE candidate from:", data.from);
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.signal(data.candidate);
      }
    });

    socket.on("peer-left", (data: { peerId: string }) => {
      console.log("Peer left:", data.peerId);
      setPeerConnected(false);
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from signaling server");
      setConnected(false);
      setPeerConnected(false);
    });

    socket.on("peer-recording-started", () => {
      console.log("🎙️ Peer started recording");
      setPeerIsRecording(true);
    });

    socket.on("peer-recording-stopped", () => {
      console.log("🎙️ Peer stopped recording");
      setPeerIsRecording(false);
    });

    socket.on("translated-audio", async ({ audioData }) => {
      console.log("🔊 Received translated audio from peer");
      console.log("📦 Audio data length:", audioData?.length);

      const audio = new Audio(audioData);

      audio.onended = () => {
        setTranslating(false);
        setPendingAudio(null);
      };

      setTranslating(true);
      try {
        // audioData is already a base64 data URL (data:audio/mpeg;base64,...)
        const audio = new Audio(audioData);

        audio.oncanplaythrough = () => {
          console.log("✅ Audio ready to play");
        };

        audio.onended = () => {
          console.log("✅ Audio finished playing");
          setTranslating(false);
        };

        audio.onerror = (e) => {
          console.error("❌ Audio playback error:", e);
          setTranslating(false);
        };

        await audio.play();
        console.log("▶️ Playing translated audio...");
      } catch (error) {
        console.error("❌ Error playing audio:", error);
        setTranslating(false);
      }
    });
  };

  const createPeer = (initiator: boolean, targetId: string, offer?: any) => {
    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current!,
      trickle: true,
    });

    peer.on("signal", (data: any) => {
      console.log("Sending signal:", data.type);
      if (!socketRef.current) return;

      if (data.type === "offer") {
        socketRef.current.emit("offer", { target: targetId, offer: data });
      } else if (data.type === "answer") {
        socketRef.current.emit("answer", { target: targetId, answer: data });
      } else {
        socketRef.current.emit("ice-candidate", {
          target: targetId,
          candidate: data,
        });
      }
    });

    peer.on("stream", (stream: any) => {
      console.log("Received remote stream");
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
      }
      setPeerConnected(true);
    });

    peer.on("error", (err: any) => {
      console.error("Peer error:", err);
    });

    peer.on("close", () => {
      console.log("Peer connection closed");
      setPeerConnected(false);
    });

    if (!initiator && offer) {
      peer.signal(offer);
    }

    peerRef.current = peer;
  };

  const disconnect = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setConnected(false);
    setPeerConnected(false);
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const startRecording = async () => {
    if (!localStreamRef.current || recording) return;

    if (socketRef.current) {
      socketRef.current.emit("recording-started", { roomId });
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/wav")
      ? "audio/wav"
      : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(localStreamRef.current, { mimeType });
    const audioChunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      setTranslating(true);

      // Notify peer that you stopped recording
      if (socketRef.current) {
        socketRef.current.emit("recording-stopped", { roomId });
      }

      const audioBlob = new Blob(audioChunks, { type: mimeType });

      if (audioBlob.size < 1000) {
        alert("Recording too short or empty!");
        setTranslating(false);
        return;
      }

      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("source_lang", sourceLang);
      formData.append("target_lang", targetLang);

      try {
        const response = await fetch(
          "https://realtime-translation-production.up.railway.app/translate-audio",
          { method: "POST", body: formData }
        );

        if (response.ok) {
          const audioData = await response.blob();

          if (audioData.size < 100) {
            alert("Translation returned no audio. Please try again.");
            setTranslating(false);
            return;
          }

          // Convert blob to base64 for socket.io
          const reader = new FileReader();
          reader.readAsDataURL(audioData);
          reader.onloadend = () => {
            const base64data = reader.result;

            // Send translated audio to peer (NOT play locally!)
            if (socketRef.current) {
              socketRef.current.emit("translated-audio", {
                roomId,
                audioData: base64data,
              });
            }

            console.log("✅ Sent translated audio to peer");
            setTranslating(false);

            setTranslations((prev) =>
              [
                {
                  original: "Your speech",
                  translated: "Sent to peer",
                  sourceLang,
                  targetLang,
                  timestamp: new Date(),
                },
                ...prev,
              ].slice(0, 5)
            );
          };
        } else {
          alert("Translation failed. Check console.");
          setTranslating(false);
        }
      } catch (error) {
        console.error("Translation error:", error);
        alert("Translation error. Check console.");
        setTranslating(false);
      }
    };

    recorder.start();
    setMediaRecorder(recorder);
    setRecording(true);

    setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
        setRecording(false);
      }
    }, 5000);
  };

  const languageOptions = [
    { value: "et", label: "Estonian", flag: "🇪🇪" },
    { value: "en", label: "English", flag: "🇬🇧" },
    { value: "es", label: "Spanish", flag: "🇪🇸" },
    { value: "de", label: "German", flag: "🇩🇪" },
  ];

  return (
    <div className="gradient-bg">
      <div className="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Globe className="w-8 h-8 text-indigo-600" />
              <h1 className="app-title">Real-Time Translation</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button onClick={toggleTheme} className="theme-toggle">
                {theme === "light" ? (
                  <Moon className="w-5 h-5 text-indigo-600" />
                ) : (
                  <Sun className="w-5 h-5 text-yellow-400" />
                )}
              </button>
              <div className="flex items-center space-x-2">
                {connected ? (
                  <Wifi className="w-5 h-5 text-green-500" />
                ) : (
                  <WifiOff className="w-5 h-5 text-gray-400" />
                )}
                <span className="header-status">
                  {connected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="card animate-fadeIn">
              <h2 className="card-header">
                <Users className="w-5 h-5 mr-2 text-indigo-600" />
                Room Connection
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="label">Room ID</label>
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Enter room ID (e.g., '123')"
                    className="input"
                    disabled={connected}
                  />
                </div>

                <div className="user-id-display">
                  <span className="user-id-label">Your ID:</span>
                  <span className="user-id-value">{clientId}</span>
                </div>

                {!connected ? (
                  <button onClick={connectToRoom} className="btn btn-primary">
                    <Phone className="w-5 h-5" />
                    <span>Connect to Room</span>
                  </button>
                ) : (
                  <button onClick={disconnect} className="btn btn-danger">
                    <PhoneOff className="w-5 h-5" />
                    <span>Disconnect</span>
                  </button>
                )}
              </div>
            </div>

            {connected && (
              <div className="card animate-fadeIn">
                <h2 className="card-header">
                  <Globe className="w-5 h-5 mr-2 text-indigo-600" />
                  Translation
                </h2>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="label">Speak in:</label>
                    <select
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                      className="select"
                      disabled={recording || translating}
                    >
                      {languageOptions.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.flag} {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Translate to:</label>
                    <select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="select"
                      disabled={recording || translating}
                    >
                      {languageOptions.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.flag} {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {peerIsRecording && (
                  <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-600 rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <Mic className="w-5 h-5 text-yellow-600 animate-pulse" />
                      <span className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                        Peer is recording...
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={startRecording}
                  disabled={recording || translating}
                  className={`btn ${
                    recording
                      ? "btn-recording"
                      : translating
                      ? "btn-translating"
                      : "btn-success"
                  } py-4`}
                >
                  {recording ? (
                    <>
                      <Mic className="w-5 h-5 animate-bounce" />
                      <span>Recording... (5s)</span>
                    </>
                  ) : translating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Translating...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      <span>Record & Translate (5s)</span>
                    </>
                  )}
                </button>

                <p className="translation-hint">
                  Translates{" "}
                  {languageOptions.find((l) => l.value === sourceLang)?.flag}{" "}
                  {sourceLang.toUpperCase()} →{" "}
                  {languageOptions.find((l) => l.value === targetLang)?.flag}{" "}
                  {targetLang.toUpperCase()}
                </p>
              </div>
            )}

            {pendingAudio && (
              <div className="card animate-fadeIn">
                <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-600 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Volume2 className="w-6 h-6 text-blue-600 animate-pulse" />
                      <span className="font-semibold text-blue-900 dark:text-blue-100">
                        Translation Ready! Tap to play →
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        const audio = new Audio(pendingAudio);
                        audio.onended = () => setPendingAudio(null);
                        await audio.play();
                      }}
                      className="btn btn-success px-6"
                    >
                      ▶️ Play
                    </button>
                  </div>
                </div>
              </div>
            )}

            {translations.length > 0 && (
              <div className="card animate-fadeIn">
                <h2 className="card-header">Recent Translations</h2>
                <div className="space-y-3">
                  {translations.map((t, i) => (
                    <div key={i} className="translation-item">
                      <div className="translation-meta">
                        <span>
                          {
                            languageOptions.find(
                              (l) => l.value === t.sourceLang
                            )?.flag
                          }{" "}
                          →{" "}
                          {
                            languageOptions.find(
                              (l) => l.value === t.targetLang
                            )?.flag
                          }
                        </span>
                        <span>{t.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="translation-original">
                          You spoke in{" "}
                          {
                            languageOptions.find(
                              (l) => l.value === t.sourceLang
                            )?.label
                          }
                        </p>
                        <div className="flex items-center space-x-2">
                          <Volume2 className="w-4 h-4 text-indigo-600" />
                          <p className="translation-result">
                            Translated to{" "}
                            {
                              languageOptions.find(
                                (l) => l.value === t.targetLang
                              )?.label
                            }{" "}
                            for peer
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="card animate-fadeIn">
              <h2 className="card-header">Status</h2>

              <div className="space-y-4">
                <div className="status-indicator">
                  <div className="flex items-center space-x-3">
                    <div
                      className={
                        connected ? "status-dot-active" : "status-dot-inactive"
                      }
                    ></div>
                    <span className="status-label">Server</span>
                  </div>
                  <span
                    className={`status-value ${
                      connected
                        ? "status-value-active"
                        : "status-value-inactive"
                    }`}
                  >
                    {connected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                <div className="status-indicator">
                  <div className="flex items-center space-x-3">
                    <div
                      className={
                        peerConnected
                          ? "status-dot-active"
                          : "status-dot-inactive"
                      }
                    ></div>
                    <span className="status-label">Peer</span>
                  </div>
                  <span
                    className={`status-value ${
                      peerConnected
                        ? "status-value-active"
                        : "status-value-inactive"
                    }`}
                  >
                    {peerConnected ? "Connected" : "Waiting"}
                  </span>
                </div>
              </div>

              {peerConnected && (
                <div className="alert-success mt-4">
                  <div className="alert-success-content">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="alert-success-text">
                      <span className="font-semibold">Call connected!</span>
                      <br />
                      You can now hear each other.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="info-card animate-fadeIn">
              <h3 className="info-title">
                <Lightbulb className="w-5 h-5 inline-block mr-2" /> How it works
              </h3>
              <ul className="info-list">
                <li className="info-list-item">
                  <span className="info-list-number">1</span>
                  <span>Connect to a room with someone else</span>
                </li>
                <li className="info-list-item">
                  <span className="info-list-number">2</span>
                  <span>Select your languages</span>
                </li>
                <li className="info-list-item">
                  <span className="info-list-number">3</span>
                  <span>Click Record & speak clearly</span>
                </li>
                <li className="info-list-item">
                  <span className="info-list-number">4</span>
                  <span>Hear the translation instantly!</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}
