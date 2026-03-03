import { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import Peer from 'peerjs';

const auth = getAuth();

// --- GLOBAL STİL ---
const StilYama = () => (
  <style>{`
    body, html { margin: 0; padding: 0; background-color: #202225; color: #dcddde; height: 100%; overflow: hidden; }
    * { box-sizing: border-box; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #2f3136; }
    ::-webkit-scrollbar-thumb { background: #202225; border-radius: 4px; }
  `}</style>
);

function App() {
  // --- AUTH STATE ---
  const [kullanici, setKullanici] = useState(null);
  const [email, setEmail] = useState("");
  const [sifre, setSifre] = useState("");
  const [hata, setHata] = useState("");
  const [kayitModu, setKayitModu] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");

  // --- CHAT STATE ---
  const [mesajlar, setMesajlar] = useState([]);
  const [yeniMesaj, setYeniMesaj] = useState("");
  const MESAJ_MAX_UZUNLUK = 2000;

  // --- VOICE STATE ---
  const [sesliSohbetteMi, setSesliSohbetteMi] = useState(false);
  const [mikrofonKapali, setMikrofonKapali] = useState(false);
  const [aktifKonusanlar, setAktifKonusanlar] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // --- SETTINGS STATE ---
  const [ayarlarAcik, setAyarlarAcik] = useState(false);
  const [ayarlarSekme, setAyarlarSekme] = useState('ses');
  const [audioAygitlari, setAudioAygitlari] = useState({ inputs: [], outputs: [] });
  const [secilenMikrofon, setSecilenMikrofon] = useState(() => localStorage.getItem('az_mikrofon') || '');
  const [secilenHoparlor, setSecilenHoparlor] = useState(() => localStorage.getItem('az_hoparlor') || '');
  const [noiseGateEsik, setNoiseGateEsik] = useState(() => parseInt(localStorage.getItem('az_ngEsik') || '12'));
  const [girisKazanci, setGirisKazanci] = useState(() => parseInt(localStorage.getItem('az_girisKazanci') || '100'));
  const [cikisHacmi, setCikisHacmi] = useState(() => parseInt(localStorage.getItem('az_cikisHacmi') || '100'));
  const [echoCancellation, setEchoCancellation] = useState(() => localStorage.getItem('az_echo') !== 'false');
  const [noiseSuppression, setNoiseSuppression] = useState(() => localStorage.getItem('az_noise') !== 'false');
  const [yeniDisplayName, setYeniDisplayName] = useState('');
  const [hesapMesaj, setHesapMesaj] = useState('');

  // --- REFS ---
  const chatKutuRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const processedStreamRef = useRef(null);
  const remoteStreamsRef = useRef({});
  const baglantiIptalRef = useRef(false);
  const heartbeatIntervalRef = useRef(null);

  // Audio processing refs
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);       // noise gate gain node
  const inputGainNodeRef = useRef(null);  // user-controlled input gain node

  // Refs that mirror settings state for use inside audio loop callbacks
  const noiseGateEsikRef = useRef(noiseGateEsik);
  const secilenHoparlorRef = useRef(secilenHoparlor);
  const cikisHacmiRef = useRef(cikisHacmi);

  useEffect(() => { noiseGateEsikRef.current = noiseGateEsik; }, [noiseGateEsik]);
  useEffect(() => { secilenHoparlorRef.current = secilenHoparlor; }, [secilenHoparlor]);
  useEffect(() => { cikisHacmiRef.current = cikisHacmi; }, [cikisHacmi]);

  // --- LIFECYCLE ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setKullanici(user || null);
      if (!user) tamTemizlik();
    });

    const qChat = query(collection(db, "chat"), orderBy("createdAt", "asc"));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      setMesajlar(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      if (chatKutuRef.current) chatKutuRef.current.scrollTop = chatKutuRef.current.scrollHeight;
    });

    const qVoice = query(collection(db, "voice_active"));
    const unsubscribeVoice = onSnapshot(qVoice, (snapshot) => {
      setAktifKonusanlar(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const handleTabClose = () => tamTemizlik();
    window.addEventListener('beforeunload', handleTabClose);

    if (window.electron) {
      window.electron.onGlobalMute(() => { toggleMikrofonIslemi(); });
      window.electron.onAppClosing(() => { tamTemizlik(); });
    }

    return () => {
      unsubscribeAuth();
      unsubscribeChat();
      unsubscribeVoice();
      window.removeEventListener('beforeunload', handleTabClose);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, []);

  // --- HEARTBEAT & GARBAGE COLLECTOR ---
  useEffect(() => {
    if (!kullanici) return;
    const reaperInterval = setInterval(() => {
      const simdi = Date.now();
      aktifKonusanlar.forEach(async (user) => {
        if (user.lastSeen?.seconds) {
          const sonGorulme = user.lastSeen.seconds * 1000;
          if (simdi - sonGorulme > 20000) {
            try { await deleteDoc(doc(db, "voice_active", user.id)); } catch (err) {}
          }
        }
      });
    }, 10000);
    return () => clearInterval(reaperInterval);
  }, [aktifKonusanlar, kullanici]);

  // --- DEVICE ENUMERATION ---
  const aygitlariTara = async () => {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) { /* already have permission or denied */ }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioAygitlari({
        inputs: devices.filter(d => d.kind === 'audioinput'),
        outputs: devices.filter(d => d.kind === 'audiooutput'),
      });
    } catch (e) { console.error("Aygit listesi alinamadi", e); }
  };

  // --- SES İŞLEME (NOISE GATE + INPUT GAIN) ---
  const noiseGateKur = (rawStream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(rawStream);

    // User-controlled input gain
    const inputGain = ctx.createGain();
    inputGain.gain.value = girisKazanci / 100;
    inputGainNodeRef.current = inputGain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;

    // Noise gate gain
    const noiseGateNode = ctx.createGain();
    gainNodeRef.current = noiseGateNode;

    source.connect(inputGain);
    inputGain.connect(analyser);
    inputGain.connect(noiseGateNode);

    const destination = ctx.createMediaStreamDestination();
    noiseGateNode.connect(destination);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!gainNodeRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
      const average = sum / bufferLength;

      if (average < noiseGateEsikRef.current) {
        noiseGateNode.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      } else {
        noiseGateNode.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
      }
      requestAnimationFrame(checkVolume);
    };
    checkVolume();
    return destination.stream;
  };

  // --- CLEANUP ---
  const tamTemizlik = async () => {
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); }
    if (auth.currentUser?.uid) { try { await deleteDoc(doc(db, "voice_active", auth.currentUser.uid)); } catch (e) {} }

    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); }
    if (processedStreamRef.current) { processedStreamRef.current.getTracks().forEach(t => t.stop()); }
    if (audioContextRef.current) { audioContextRef.current.close(); }

    localStreamRef.current = null;
    processedStreamRef.current = null;
    audioContextRef.current = null;
    gainNodeRef.current = null;
    inputGainNodeRef.current = null;

    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
    Object.values(remoteStreamsRef.current).forEach(audioEl => { if (audioEl?.parentNode) audioEl.parentNode.removeChild(audioEl); });
    remoteStreamsRef.current = {};

    setSesliSohbetteMi(false);
    setIsConnecting(false);
    setMikrofonKapali(false);
  };

  const toggleMikrofonIslemi = async () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const yeniDurum = !audioTrack.enabled;
        audioTrack.enabled = yeniDurum;
        setMikrofonKapali(!yeniDurum);
        if (auth.currentUser) {
          try {
            await updateDoc(doc(db, "voice_active", auth.currentUser.uid), { isMuted: !yeniDurum });
          } catch (e) { console.error("Mute update hatasi", e); }
        }
      }
    }
  };

  const mikrofonuTogglela = () => { toggleMikrofonIslemi(); };

  const seseKatil = async () => {
    if (isConnecting || sesliSohbetteMi) return;
    setIsConnecting(true);
    baglantiIptalRef.current = false;
    setHata("");
    setMikrofonKapali(false);

    const timeOutId = setTimeout(() => {
      if (!sesliSohbetteMi && isConnecting) baglantiyiIptalEt("Baglanti zaman asimina ugradi.");
    }, 15000);

    try {
      const audioConstraints = {
        echoCancellation,
        noiseSuppression,
        autoGainControl: false,
      };
      if (secilenMikrofon) audioConstraints.deviceId = { exact: secilenMikrofon };

      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });

      if (baglantiIptalRef.current) { rawStream.getTracks().forEach(t => t.stop()); clearTimeout(timeOutId); return; }
      localStreamRef.current = rawStream;

      const cleanStream = noiseGateKur(rawStream);
      processedStreamRef.current = cleanStream;

      const peer = new Peer(undefined);

      peer.on('open', async (peerId) => {
        clearTimeout(timeOutId);
        if (baglantiIptalRef.current) { peer.destroy(); tamTemizlik(); return; }

        await setDoc(doc(db, "voice_active", kullanici.uid), {
          uid: kullanici.uid,
          displayName: kullanici.displayName || kullanici.email.split('@')[0],
          photoURL: kullanici.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png",
          peerId: peerId,
          isMuted: false,
          lastSeen: serverTimestamp()
        });

        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(async () => {
          try { await updateDoc(doc(db, "voice_active", kullanici.uid), { lastSeen: serverTimestamp() }); } catch (err) {}
        }, 5000);

        peerRef.current = peer;
        setSesliSohbetteMi(true);
        setIsConnecting(false);

        const snapshot = await getDocs(collection(db, "voice_active"));
        snapshot.forEach((d) => {
          const data = d.data();
          if (data.peerId !== peerId) {
            const call = peer.call(data.peerId, cleanStream);
            call.on('stream', (remoteStream) => streamGeldi(data.uid, remoteStream));
          }
        });
      });

      peer.on('call', (call) => {
        call.answer(cleanStream);
        call.on('stream', (remoteStream) => streamGeldi(call.peer, remoteStream));
      });

      peer.on('error', (err) => { console.error(err); baglantiyiIptalEt("Baglanti hatasi."); });

    } catch (error) { console.error(error); baglantiyiIptalEt("Mikrofon hatasi."); }
  };

  const baglantiyiIptalEt = (ozelMesaj = "") => {
    baglantiIptalRef.current = true;
    if (ozelMesaj) alert(ozelMesaj);
    tamTemizlik();
  };

  const streamGeldi = (remotePeerId, stream) => {
    if (!document.getElementById(`audio-${remotePeerId}`)) {
      const audio = document.createElement('audio');
      audio.id = `audio-${remotePeerId}`;
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.volume = cikisHacmiRef.current / 100;
      if (secilenHoparlorRef.current && audio.setSinkId) {
        audio.setSinkId(secilenHoparlorRef.current).catch(e => console.error("setSinkId hatasi", e));
      }
      document.body.appendChild(audio);
      remoteStreamsRef.current[remotePeerId] = audio;
    }
  };

  // --- SETTINGS HANDLERS ---
  const mikrofonuDegistir = (deviceId) => {
    setSecilenMikrofon(deviceId);
    localStorage.setItem('az_mikrofon', deviceId);
  };

  const hoparloruDegistir = async (deviceId) => {
    setSecilenHoparlor(deviceId);
    localStorage.setItem('az_hoparlor', deviceId);
    for (const audioEl of Object.values(remoteStreamsRef.current)) {
      if (audioEl?.setSinkId) {
        await audioEl.setSinkId(deviceId).catch(e => console.error("setSinkId hatasi", e));
      }
    }
  };

  const noiseGateEsikDegistir = (deger) => {
    const v = parseInt(deger);
    setNoiseGateEsik(v);
    noiseGateEsikRef.current = v;
    localStorage.setItem('az_ngEsik', v);
  };

  const girisKazanciDegistir = (deger) => {
    const v = parseInt(deger);
    setGirisKazanci(v);
    localStorage.setItem('az_girisKazanci', v);
    if (inputGainNodeRef.current) inputGainNodeRef.current.gain.value = v / 100;
  };

  const cikisHacmiDegistir = (deger) => {
    const v = parseInt(deger);
    setCikisHacmi(v);
    cikisHacmiRef.current = v;
    localStorage.setItem('az_cikisHacmi', v);
    Object.values(remoteStreamsRef.current).forEach(audioEl => {
      if (audioEl) audioEl.volume = v / 100;
    });
  };

  const echoCancellationDegistir = (deger) => {
    setEchoCancellation(deger);
    localStorage.setItem('az_echo', deger);
  };

  const noiseSuppressionDegistir = (deger) => {
    setNoiseSuppression(deger);
    localStorage.setItem('az_noise', deger);
  };

  const displayNameGuncelle = async (e) => {
    e.preventDefault();
    if (!yeniDisplayName.trim()) return;
    try {
      await updateProfile(auth.currentUser, { displayName: yeniDisplayName.trim() });
      setHesapMesaj("Kullanici adi guncellendi!");
      setYeniDisplayName('');
      setTimeout(() => setHesapMesaj(''), 3000);
    } catch (_) { setHesapMesaj("Guncelleme basarisiz."); }
  };

  // --- AUTH ---
  const girisYap = async (e) => {
    e.preventDefault();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, sifre);
      if (!userCredential.user.displayName) { await updateProfile(userCredential.user, { displayName: email.split('@')[0], photoURL: `https://ui-avatars.com/api/?name=${email.split('@')[0]}&background=random` }); }
      setHata("");
    } catch (error) { setHata("Giris basarisiz. E-posta veya sifre hatali."); }
  };

  const kayitOl = async (e) => {
    e.preventDefault();
    if (!displayNameInput.trim()) { setHata("Kullanici adi bos olamaz."); return; }
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, sifre);
      const name = displayNameInput.trim();
      await updateProfile(userCredential.user, { displayName: name, photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random` });
      setHata("");
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') { setHata("Bu e-posta adresi zaten kullaniliyor."); }
      else if (error.code === 'auth/weak-password') { setHata("Sifre en az 6 karakter olmalidir."); }
      else { setHata("Kayit basarisiz. Lutfen tekrar deneyin."); }
    }
  };

  const mesajGonder = async (e) => {
    e.preventDefault();
    if (yeniMesaj.trim() === "" || !kullanici) return;
    await addDoc(collection(db, "chat"), { text: yeniMesaj, sender: kullanici.displayName || kullanici.email, photo: kullanici.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png", uid: kullanici.uid, createdAt: serverTimestamp() });
    setYeniMesaj("");
  };

  // --- SETTINGS MODAL ---
  const AyarlarModal = () => {
    if (!ayarlarAcik) return null;

    const inputStyle = { width: "100%", padding: "8px 10px", background: "#202225", border: "1px solid #1a1b1e", color: "white", borderRadius: "4px", fontSize: "14px" };
    const labelStyle = { display: "block", marginBottom: "6px", color: "#b9bbbe", fontSize: "11px", textTransform: "uppercase", fontWeight: "bold" };
    const sectionStyle = { marginBottom: "24px" };
    const sliderRow = { display: "flex", alignItems: "center", gap: "10px" };
    const valLabel = { color: "white", fontSize: "14px", minWidth: "44px", textAlign: "right" };
    const divider = { border: "none", borderTop: "1px solid #202225", margin: "0 0 24px 0" };

    const Toggle = ({ on, onChange }) => (
      <button
        onClick={() => onChange(!on)}
        style={{ width: "40px", height: "22px", background: on ? "#43b581" : "#4f545c", borderRadius: "11px", position: "relative", cursor: "pointer", transition: "background 0.2s", border: "none", flexShrink: 0 }}
      >
        <div style={{ position: "absolute", width: "16px", height: "16px", background: "white", borderRadius: "50%", top: "3px", left: on ? "21px" : "3px", transition: "left 0.2s" }} />
      </button>
    );

    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={(e) => { if (e.target === e.currentTarget) setAyarlarAcik(false); }}
      >
        <div style={{ background: "#36393f", borderRadius: "8px", width: "620px", maxWidth: "95vw", maxHeight: "85vh", display: "flex", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>

          {/* Sol sekme menusu */}
          <div style={{ width: "180px", background: "#2f3136", padding: "16px 8px", flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#72767d", fontSize: "11px", textTransform: "uppercase", fontWeight: "bold", padding: "4px 8px 8px", letterSpacing: "0.5px" }}>Kullanici Ayarlari</div>
            {[['ses', '🎧 Ses'], ['hesap', '👤 Hesap']].map(([key, label]) => (
              <div
                key={key}
                onClick={() => setAyarlarSekme(key)}
                style={{ padding: "8px 12px", borderRadius: "4px", cursor: "pointer", marginBottom: "2px", background: ayarlarSekme === key ? "#42464d" : "transparent", color: ayarlarSekme === key ? "white" : "#b9bbbe", fontSize: "14px" }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Icerik alani */}
          <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, color: "white", fontSize: "18px" }}>{ayarlarSekme === 'ses' ? '🎧 Ses Ayarlari' : '👤 Hesap'}</h2>
              <button onClick={() => setAyarlarAcik(false)} style={{ background: "transparent", border: "none", color: "#72767d", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            {/* SES SEKMESI */}
            {ayarlarSekme === 'ses' && (
              <>
                <div style={sectionStyle}>
                  <label style={labelStyle}>Giris Aygiti (Mikrofon)</label>
                  <select value={secilenMikrofon} onChange={e => mikrofonuDegistir(e.target.value)} style={inputStyle}>
                    <option value="">— Varsayilan —</option>
                    {audioAygitlari.inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mikrofon (${d.deviceId.slice(0, 8)})`}</option>)}
                  </select>
                  {sesliSohbetteMi && <p style={{ color: "#faa61a", fontSize: "12px", margin: "6px 0 0" }}>⚠️ Mikrofon degisikligi sonraki baglantida gecerli olur.</p>}
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Cikis Aygiti (Hoparlor / Kulaklik)</label>
                  <select value={secilenHoparlor} onChange={e => hoparloruDegistir(e.target.value)} style={inputStyle}>
                    <option value="">— Varsayilan —</option>
                    {audioAygitlari.outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Hoparlor (${d.deviceId.slice(0, 8)})`}</option>)}
                  </select>
                </div>

                <hr style={divider} />

                <div style={sectionStyle}>
                  <label style={labelStyle}>Mikrofon Giris Sesi</label>
                  <div style={sliderRow}>
                    <input type="range" min="0" max="200" value={girisKazanci} onChange={e => girisKazanciDegistir(e.target.value)} style={{ flex: 1, accentColor: "#5865f2" }} />
                    <span style={valLabel}>{girisKazanci}%</span>
                  </div>
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Cikis Sesi</label>
                  <div style={sliderRow}>
                    <input type="range" min="0" max="100" value={cikisHacmi} onChange={e => cikisHacmiDegistir(e.target.value)} style={{ flex: 1, accentColor: "#5865f2" }} />
                    <span style={valLabel}>{cikisHacmi}%</span>
                  </div>
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Gurultu Kapisi Esigi</label>
                  <div style={sliderRow}>
                    <input type="range" min="0" max="50" value={noiseGateEsik} onChange={e => noiseGateEsikDegistir(e.target.value)} style={{ flex: 1, accentColor: "#5865f2" }} />
                    <span style={valLabel}>{noiseGateEsik}</span>
                  </div>
                  <p style={{ color: "#72767d", fontSize: "12px", margin: "6px 0 0" }}>Dusuk = daha hassas | Yuksek = sadece guclu sesler gecer. Aktif baglantiaya anlik uygulanir.</p>
                </div>

                <hr style={divider} />

                <div style={{ ...sectionStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ color: "white", fontSize: "14px" }}>Eko Iptali</div>
                    <div style={{ color: "#72767d", fontSize: "12px" }}>Hoparlorden mikrofona geri donusu engeller.</div>
                  </div>
                  <Toggle on={echoCancellation} onChange={echoCancellationDegistir} />
                </div>

                <div style={{ ...sectionStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ color: "white", fontSize: "14px" }}>Gurultu Bastirma</div>
                    <div style={{ color: "#72767d", fontSize: "12px" }}>Arka plan gurultusunu azaltir.</div>
                  </div>
                  <Toggle on={noiseSuppression} onChange={noiseSuppressionDegistir} />
                </div>

                <p style={{ color: "#faa61a", fontSize: "12px", marginTop: 0 }}>⚠️ Eko iptali ve gurultu bastirma degisiklikleri sonraki baglantida gecerli olur.</p>
              </>
            )}

            {/* HESAP SEKMESI */}
            {ayarlarSekme === 'hesap' && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px", background: "#2f3136", padding: "16px", borderRadius: "8px" }}>
                  <img src={kullanici?.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png"} style={{ width: "64px", height: "64px", borderRadius: "50%" }} alt="avatar" />
                  <div>
                    <div style={{ color: "white", fontWeight: "bold", fontSize: "18px" }}>{kullanici?.displayName}</div>
                    <div style={{ color: "#72767d", fontSize: "14px" }}>{kullanici?.email}</div>
                  </div>
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Kullanici Adini Degistir</label>
                  <form onSubmit={displayNameGuncelle} style={{ display: "flex", gap: "8px" }}>
                    <input type="text" placeholder="Yeni kullanici adi" value={yeniDisplayName} onChange={e => setYeniDisplayName(e.target.value)} style={{ ...inputStyle, flex: 1 }} maxLength={32} />
                    <button type="submit" style={{ padding: "8px 16px", background: "#5865f2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", whiteSpace: "nowrap" }}>Kaydet</button>
                  </form>
                  {hesapMesaj && <p style={{ color: hesapMesaj.includes('basarisiz') ? "#ed4245" : "#43b581", fontSize: "12px", marginTop: "6px" }}>{hesapMesaj}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- LOGIN / REGISTER SCREEN ---
  if (!kullanici) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#2f3136" }}>
        <StilYama />
        <div style={{ background: "#36393f", padding: "40px", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.2)", width: "350px" }}>
          <h2 style={{ textAlign: "center", color: "#fff", marginBottom: "20px" }}>{kayitModu ? "ArguZone Kayit" : "ArguZone Giris"}</h2>
          <form onSubmit={kayitModu ? kayitOl : girisYap} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            {kayitModu && (
              <input type="text" placeholder="Kullanici Adi" value={displayNameInput} onChange={e => setDisplayNameInput(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required />
            )}
            <input type="email" placeholder="E-posta" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required />
            <input type="password" placeholder="Sifre" value={sifre} onChange={e => setSifre(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required />
            <button type="submit" style={{ padding: "12px", background: "#5865f2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>{kayitModu ? "Kayit Ol" : "Giris Yap"}</button>
          </form>
          {hata && <p style={{ color: "#ed4245", marginTop: "10px", fontSize: "14px", textAlign: "center" }}>{hata}</p>}
          <p style={{ textAlign: "center", marginTop: "15px", fontSize: "13px", color: "#b9bbbe" }}>
            {kayitModu ? "Zaten hesabin var mi?" : "Hesabin yok mu?"}
            <span onClick={() => { setKayitModu(!kayitModu); setHata(""); }} style={{ color: "#5865f2", cursor: "pointer", fontWeight: "bold" }}>{kayitModu ? " Giris Yap" : " Kayit Ol"}</span>
          </p>
        </div>
      </div>
    );
  }

  // --- MAIN APP ---
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Arial, sans-serif" }}>
      <StilYama />
      <AyarlarModal />

      {/* Ust Bar */}
      <div style={{ height: "50px", background: "#202225", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", boxShadow: "0 1px 0 rgba(0,0,0,0.2)", flexShrink: 0 }}>
        <div style={{ fontWeight: "bold", color: "white" }}>ArguZone v0.0.1</div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "14px", color: "#b9bbbe" }}>{kullanici.displayName || kullanici.email}</span>
          <button
            title="Ayarlar"
            onClick={() => { aygitlariTara(); setAyarlarSekme('ses'); setAyarlarAcik(true); }}
            style={{ background: "transparent", border: "none", color: "#b9bbbe", fontSize: "18px", cursor: "pointer", padding: "4px 6px", borderRadius: "4px", lineHeight: 1 }}
          >⚙️</button>
          <button onClick={() => { tamTemizlik(); signOut(auth); }} style={{ background: "#ed4245", color: "white", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>Cikis</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sol Panel: Ses Kanallari */}
        <div style={{ width: "240px", background: "#2f3136", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "15px", borderBottom: "1px solid #202225", color: "#8e9297", fontSize: "12px", textTransform: "uppercase", fontWeight: "bold" }}>SES KANALLARI</div>
          <div style={{ padding: "10px", flex: 1, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "10px", color: "#8e9297" }}>
              <span>🔊</span> <span>Genel Sohbet</span>
            </div>
            <div style={{ marginLeft: "20px" }}>
              {aktifKonusanlar.map(u => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "white", opacity: u.isMuted ? 0.5 : 1 }}>
                  <div style={{ position: "relative" }}>
                    <img src={u.photoURL} style={{ width: "24px", height: "24px", borderRadius: "50%", border: u.uid === kullanici.uid ? "2px solid #43b581" : "none" }} alt="avt" />
                    {u.isMuted && (
                      <div style={{ position: "absolute", bottom: "-2px", right: "-5px", background: "#36393f", borderRadius: "50%", padding: "1px" }}>
                        <span style={{ fontSize: "10px" }}>🔇</span>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "14px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", color: u.isMuted ? "#b9bbbe" : "white" }}>
                    {u.displayName}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Alt Kontrol Paneli */}
          <div style={{ padding: "10px", background: "#292b2f" }}>
            {!sesliSohbetteMi ? (
              <button onClick={isConnecting ? () => baglantiyiIptalEt() : seseKatil} style={{ width: "100%", padding: "10px", background: isConnecting ? "#faa61a" : "#43b581", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                {isConnecting ? "Iptal Et (X)" : "Sese Katil"}
              </button>
            ) : (
              <div style={{ display: "flex", gap: "5px" }}>
                <button onClick={mikrofonuTogglela} style={{ flex: 1, padding: "10px", background: mikrofonKapali ? "#ed4245" : "white", color: mikrofonKapali ? "white" : "black", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                  {mikrofonKapali ? "Kapali (M)" : "Acik (M)"}
                </button>
                <button onClick={() => baglantiyiIptalEt()} style={{ width: "40px", padding: "10px", background: "#202225", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>X</button>
              </div>
            )}
          </div>
        </div>

        {/* Sag Panel: Chat */}
        <div style={{ flex: 1, background: "#36393f", display: "flex", flexDirection: "column" }}>
          <div ref={chatKutuRef} style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {mesajlar.map(m => (
              <div key={m.id} style={{ display: "flex", gap: "15px", marginBottom: "20px" }}>
                <img src={m.photo} style={{ width: "40px", height: "40px", borderRadius: "50%", marginTop: "5px" }} alt="avatar" />
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                    <span style={{ color: "white", fontWeight: "bold", cursor: "pointer" }}>{m.sender}</span>
                    <span style={{ color: "#72767d", fontSize: "12px" }}>{m.createdAt?.seconds ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "..."}</span>
                  </div>
                  <div style={{ color: "#dcddde", marginTop: "5px", lineHeight: "1.4" }}>{m.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 20px 20px 20px" }}>
            <form onSubmit={mesajGonder} style={{ background: "#40444b", borderRadius: "8px", padding: "0 15px", display: "flex", alignItems: "center", gap: "8px" }}>
              <input value={yeniMesaj} onChange={(e) => setYeniMesaj(e.target.value.slice(0, MESAJ_MAX_UZUNLUK))} placeholder="#genel-sohbet kanalina mesaj gonder" style={{ flex: 1, background: "transparent", border: "none", padding: "15px 0", color: "white", outline: "none" }} />
              {yeniMesaj.length > MESAJ_MAX_UZUNLUK * 0.8 && (
                <span style={{ fontSize: "12px", color: yeniMesaj.length >= MESAJ_MAX_UZUNLUK ? "#ed4245" : "#faa61a", whiteSpace: "nowrap" }}>
                  {MESAJ_MAX_UZUNLUK - yeniMesaj.length}
                </span>
              )}
              <button type="submit" disabled={yeniMesaj.trim() === ""} style={{ background: "transparent", border: "none", cursor: yeniMesaj.trim() ? "pointer" : "default", padding: "0", fontSize: "20px", color: yeniMesaj.trim() ? "#5865f2" : "#4f545c", lineHeight: 1 }}>➤</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
