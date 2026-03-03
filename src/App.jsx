import { useState, useEffect, useRef } from 'react';
// DİKKAT: firebase.js dosyanın src klasöründe olduğunu varsayıyorum
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
  // --- STATE ---
  const [kullanici, setKullanici] = useState(null);
  const [email, setEmail] = useState("");
  const [sifre, setSifre] = useState("");
  const [hata, setHata] = useState("");
  
  const [kayitModu, setKayitModu] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");

  const [mesajlar, setMesajlar] = useState([]);
  const [yeniMesaj, setYeniMesaj] = useState("");
  const MESAJ_MAX_UZUNLUK = 2000;
  
  const [sesliSohbetteMi, setSesliSohbetteMi] = useState(false);
  const [mikrofonKapali, setMikrofonKapali] = useState(false);
  const [aktifKonusanlar, setAktifKonusanlar] = useState([]); 
  const [isConnecting, setIsConnecting] = useState(false);

  // --- REFS ---
  const chatKutuRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null); // Ham mikrofon
  const processedStreamRef = useRef(null); // İşlenmiş (Filtreli) ses
  const remoteStreamsRef = useRef({});
  const baglantiIptalRef = useRef(false);
  const heartbeatIntervalRef = useRef(null);
  
  // Noise Gate Refs
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);

  // --- LIFECYCLE ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setKullanici(user || null);
      if (!user) tamTemizlik();
    });

    const qChat = query(collection(db, "chat"), orderBy("createdAt", "asc"));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      setMesajlar(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      if (chatKutuRef.current) chatKutuRef.current.scrollTop = chatKutuRef.current.scrollHeight;
    });

    const qVoice = query(collection(db, "voice_active"));
    const unsubscribeVoice = onSnapshot(qVoice, (snapshot) => {
      setAktifKonusanlar(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const handleTabClose = () => tamTemizlik();
    window.addEventListener('beforeunload', handleTabClose);

    // Electron Mute Listener
    if (window.electron) {
      window.electron.onGlobalMute(() => {
          toggleMikrofonIslemi(); 
      });
      window.electron.onAppClosing(() => {
          tamTemizlik();
      });
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
                if (simdi - sonGorulme > 20000) { // 20 saniye tolerans
                    try { await deleteDoc(doc(db, "voice_active", user.id)); } catch (err) {}
                }
            }
        });
    }, 10000);
    return () => clearInterval(reaperInterval);
  }, [aktifKonusanlar, kullanici]);

  // --- SES İŞLEME (NOISE GATE) ---
  const noiseGateKur = (rawStream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(rawStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512; 
    const gainNode = ctx.createGain();
    
    source.connect(analyser);
    source.connect(gainNode);
    
    const destination = ctx.createMediaStreamDestination();
    gainNode.connect(destination);
    
    gainNodeRef.current = gainNode;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkVolume = () => {
        if (!sesliSohbetteMi && !gainNodeRef.current) return; 

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        const average = sum / bufferLength;

        // Eşik Değeri (Threshold)
        const threshold = 12; 

        if (average < threshold) {
            gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        } else {
            gainNode.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
        }
        
        requestAnimationFrame(checkVolume);
    };
    
    checkVolume();
    return destination.stream; 
  };

  const tamTemizlik = async () => {
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); }
    if (auth.currentUser?.uid) { try { await deleteDoc(doc(db, "voice_active", auth.currentUser.uid)); } catch(e){} }
    
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); }
    if (processedStreamRef.current) { processedStreamRef.current.getTracks().forEach(t => t.stop()); }
    if (audioContextRef.current) { audioContextRef.current.close(); }

    localStreamRef.current = null;
    processedStreamRef.current = null;
    audioContextRef.current = null;

    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
    Object.values(remoteStreamsRef.current).forEach(audioEl => { if(audioEl?.parentNode) audioEl.parentNode.removeChild(audioEl); });
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
                    await updateDoc(doc(db, "voice_active", auth.currentUser.uid), {
                        isMuted: !yeniDurum
                    });
                  } catch(e) { console.error("Mute update hatası", e); }
              }
          }
      }
  };

  const mikrofonuTogglela = () => {
      toggleMikrofonIslemi();
  };

  const seseKatil = async () => {
    if (isConnecting || sesliSohbetteMi) return;
    setIsConnecting(true);
    baglantiIptalRef.current = false;
    setHata("");
    setMikrofonKapali(false);

    const timeOutId = setTimeout(() => {
        if (!sesliSohbetteMi && isConnecting) baglantiyiIptalEt("Bağlantı zaman aşımına uğradı.");
    }, 15000);

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
            echoCancellation: true, 
            noiseSuppression: true, 
            autoGainControl: false 
        },
        video: false
      });
      
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
        snapshot.forEach((doc) => {
            const data = doc.data();
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

      peer.on('error', (err) => { console.error(err); baglantiyiIptalEt("Bağlantı hatası."); });

    } catch (error) { console.error(error); baglantiyiIptalEt("Mikrofon hatası."); }
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
        document.body.appendChild(audio);
        remoteStreamsRef.current[remotePeerId] = audio;
    }
  };

  const girisYap = async (e) => {
    e.preventDefault();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, sifre);
      if (!userCredential.user.displayName) { await updateProfile(userCredential.user, { displayName: email.split('@')[0], photoURL: `https://ui-avatars.com/api/?name=${email.split('@')[0]}&background=random` }); }
      setHata("");
    } catch (error) { setHata("Giriş başarısız. E-posta veya şifre hatalı."); }
  };

  const kayitOl = async (e) => {
    e.preventDefault();
    if (!displayNameInput.trim()) { setHata("Kullanıcı adı boş olamaz."); return; }
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, sifre);
      const name = displayNameInput.trim();
      await updateProfile(userCredential.user, { displayName: name, photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random` });
      setHata("");
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') { setHata("Bu e-posta adresi zaten kullanılıyor."); }
      else if (error.code === 'auth/weak-password') { setHata("Şifre en az 6 karakter olmalıdır."); }
      else { setHata("Kayıt başarısız. Lütfen tekrar deneyin."); }
    }
  };

  const mesajGonder = async (e) => {
    e.preventDefault();
    if (yeniMesaj.trim() === "" || !kullanici) return;
    await addDoc(collection(db, "chat"), { text: yeniMesaj, sender: kullanici.displayName || kullanici.email, photo: kullanici.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png", uid: kullanici.uid, createdAt: serverTimestamp() });
    setYeniMesaj("");
  };

  if (!kullanici) { return ( <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", background: "#2f3136" }}> <StilYama /> <div style={{ background: "#36393f", padding: "40px", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.2)", width: "350px" }}> <h2 style={{ textAlign: "center", color: "#fff", marginBottom: "20px" }}>{kayitModu ? "ArguZone Kayıt" : "ArguZone Giriş"}</h2> <form onSubmit={kayitModu ? kayitOl : girisYap} style={{ display: "flex", flexDirection: "column", gap: "15px" }}> {kayitModu && ( <input type="text" placeholder="Kullanıcı Adı" value={displayNameInput} onChange={e => setDisplayNameInput(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required /> )} <input type="email" placeholder="E-posta" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required /> <input type="password" placeholder="Şifre" value={sifre} onChange={e => setSifre(e.target.value)} style={{ padding: "10px", background: "#202225", border: "1px solid #202225", color: "white", borderRadius: "4px" }} required /> <button type="submit" style={{ padding: "12px", background: "#5865f2", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>{kayitModu ? "Kayıt Ol" : "Giriş Yap"}</button> </form> {hata && <p style={{ color: "#ed4245", marginTop: "10px", fontSize: "14px", textAlign: "center" }}>{hata}</p>} <p style={{ textAlign: "center", marginTop: "15px", fontSize: "13px", color: "#b9bbbe" }}>{kayitModu ? "Zaten hesabın var mı?" : "Hesabın yok mu?"} <span onClick={() => { setKayitModu(!kayitModu); setHata(""); }} style={{ color: "#5865f2", cursor: "pointer", fontWeight: "bold" }}>{kayitModu ? " Giriş Yap" : " Kayıt Ol"}</span></p> </div> </div> ); }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Arial, sans-serif" }}>
      <StilYama />
      {/* Üst Bar */}
      <div style={{ height: "50px", background: "#202225", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", boxShadow: "0 1px 0 rgba(0,0,0,0.2)" }}>
        <div style={{ fontWeight: "bold", color: "white" }}>ArguZone v0.0.1</div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "14px", color: "#b9bbbe" }}>{kullanici.displayName || kullanici.email}</span>
            <button onClick={() => { tamTemizlik(); signOut(auth); }} style={{ background: "#ed4245", color: "white", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>Çıkış</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sol Panel: Ses Kanalları */}
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
                        {isConnecting ? "İptal Et (X)" : "Sese Katıl"}
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: "5px" }}>
                        <button onClick={mikrofonuTogglela} style={{ flex: 1, padding: "10px", background: mikrofonKapali ? "#ed4245" : "white", color: mikrofonKapali ? "white" : "black", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            {mikrofonKapali ? "Kapalı (M)" : "Açık (M)"}
                        </button>
                        <button onClick={() => baglantiyiIptalEt()} style={{ width: "40px", padding: "10px", background: "#202225", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}> X </button>
                    </div>
                  )}
            </div>
        </div>

        {/* Sağ Panel: Chat */}
        <div style={{ flex: 1, background: "#36393f", display: "flex", flexDirection: "column" }}>
            <div ref={chatKutuRef} style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                {mesajlar.map(m => (
                    <div key={m.id} style={{ display: "flex", gap: "15px", marginBottom: "20px" }}>
                        <img src={m.photo} style={{ width: "40px", height: "40px", borderRadius: "50%", marginTop: "5px" }} alt="avatar" />
                        <div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                                <span style={{ color: "white", fontWeight: "bold", cursor: "pointer" }}>{m.sender}</span>
                                <span style={{ color: "#72767d", fontSize: "12px" }}>{m.createdAt?.seconds ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "..."}</span>
                            </div>
                            <div style={{ color: "#dcddde", marginTop: "5px", lineHeight: "1.4" }}>{m.text}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div style={{ padding: "0 20px 20px 20px" }}>
                <form onSubmit={mesajGonder} style={{ background: "#40444b", borderRadius: "8px", padding: "0 15px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <input value={yeniMesaj} onChange={(e) => setYeniMesaj(e.target.value.slice(0, MESAJ_MAX_UZUNLUK))} placeholder={`#genel-sohbet kanalına mesaj gönder`} style={{ flex: 1, background: "transparent", border: "none", padding: "15px 0", color: "white", outline: "none" }} />
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