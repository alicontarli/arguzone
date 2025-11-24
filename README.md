# ArguZone (Beta v0.0.1)

![Status](https://img.shields.io/badge/Status-Beta-orange) ![Version](https://img.shields.io/badge/Version-v0.0.1-blue) ![License](https://img.shields.io/badge/License-MIT-green)

**ArguZone**, arkadaş grupları için tasarlanmış, düşük gecikmeli sesli ve yazılı iletişim sağlayan modern bir sohbet uygulamasıdır. Web teknolojilerinin gücünü Electron ile masaüstüne taşıyarak Discord benzeri bir deneyim sunmayı hedefler.

## 🚀 Özellikler

* **Gerçek Zamanlı Mesajlaşma:** Firebase Firestore altyapısı ile anlık yazılı iletişim.
* **P2P Sesli Sohbet:** PeerJS kullanılarak sunucu maliyeti olmadan, kullanıcılar arasında doğrudan ve düşük gecikmeli ses aktarımı.
* **Masaüstü Entegrasyonu:**
    * Electron ile Windows üzerinde native uygulama deneyimi.
    * **Global Mute (Susturma):** Uygulama arka planda olsa bile `Alt + M` kısayolu ile mikrofonu açıp kapatabilme.
* **Çapraz Platform:** Hem web tarayıcısında hem de masaüstü uygulaması olarak çalışabilir yapı.

## 🛠️ Teknoloji Yığını (Tech Stack)

Bu proje aşağıdaki teknolojiler kullanılarak geliştirilmiştir:

* **Core:** [React](https://react.dev/) + [Vite](https://vitejs.dev/)
* **Desktop Framework:** [Electron](https://www.electronjs.org/)
* **Backend & Database:** [Firebase](https://firebase.google.com/) (Auth & Firestore)
* **Voice / P2P:** [PeerJS](https://peerjs.com/) (WebRTC Wrapper)
* **Build Tool:** Electron Builder

## ⚙️ Kurulum ve Çalıştırma

Projeyi yerel ortamınızda çalıştırmak için aşağıdaki adımları izleyin:

### 1. Depoyu Klonlayın
```bash
git clone [https://github.com/KULLANICI_ADINIZ/arguzone-beta.git](https://github.com/KULLANICI_ADINIZ/arguzone-beta.git)
cd arguzone-beta
```
### 2. Bağımlılıkları Yükleyin
```Bash
npm install
```
### 3. Çevresel Değişkenler (.env)
Projenin çalışması için Firebase ve PeerJS yapılandırmalarını içeren bir .env dosyasına ihtiyacınız vardır. Ana dizinde .env dosyası oluşturun ve aşağıdaki anahtarları kendi Firebase projenizden alarak doldurun:

Kod snippet'i
```Bash
VITE_API_KEY=your_firebase_api_key
VITE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_PROJECT_ID=your_project_id
VITE_STORAGE_BUCKET=your_project.appspot.com
VITE_MESSAGING_SENDER_ID=your_sender_id
VITE_APP_ID=your_app_id
```
### 4. Geliştirme Modunda Çalıştırma (Dev)
Web ve Electron'u aynı anda geliştirme modunda açmak için:
```Bash
npm run electron:dev
```
Sadece Web sürümü için:
```Bash
npm run dev
```

### 📦 Build (Derleme)
Windows için .exe dosyası oluşturmak istiyorsanız:
```Bash
npm run electron:build
```
Çıktı dosyaları release/ klasöründe oluşturulacaktır.

### 🤝 Katkı
Bu proje şu anda geliştirme aşamasındadır. Hataları "Issues" sekmesinden bildirebilirsiniz.
