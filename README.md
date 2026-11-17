<div align="center">

# Poly Browser

**Akıcı, RAM dostu, gizlilik odaklı ve sıfır telemetri ilkeli modern masaüstü web tarayıcısı**

[![Son Sürüm](https://img.shields.io/github/v/release/MehmetShin/PolyBrowser?style=for-the-badge&color=7c5cff&label=S%C3%BCr%C3%BCm)](https://github.com/MehmetShin/PolyBrowser/releases/latest)
[![Toplam İndirme](https://img.shields.io/github/downloads/MehmetShin/PolyBrowser/total?style=for-the-badge&color=10b981&label=%C4%B0ndirme)](https://github.com/MehmetShin/PolyBrowser/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20(64--bit)-0078D6?style=for-the-badge&logo=windows)](https://github.com/MehmetShin/PolyBrowser/releases/latest)
[![Lisans](https://img.shields.io/github/license/MehmetShin/PolyBrowser?style=for-the-badge&color=f59e0b&label=Lisans)](./LICENSE)

<br />

[**Hemen İndir (v1.4.13)**](https://github.com/MehmetShin/PolyBrowser/releases/tag/v1.3.4) •
[**Özellikler**](#öne-çıkan-özellikler) •
[**Güvenlik ve Gizlilik**](#güvenlik-mimarisi-ve-gizlilik) •
[**Klavye Kısayolları**](#klavye-kısayolları) •
[**Sorun Bildir**](https://github.com/MehmetShin/PolyBrowser/issues)

</div>

---

## Poly Browser Nedir?

**Poly Browser**, modern Chromium altyapısını düşük bellek tüketimi, yerleşik ağ korumaları ve tamamen cihaz içi (Local-First) parola güvenliği ile birleştiren bir masaüstü web tarayıcısıdır. Gezinme geçmişiniz, form verileriniz ve kayıtlı şifreleriniz yalnızca kendi bilgisayarınızda tutulur.

---

## Öne Çıkan Özellikler

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Poly Control — RAM ve Uyku Modu</h3>
      <ul>
        <li>Belirlediğiniz <strong>RAM limitine (MB)</strong> göre arka plandaki pasif sekmeleri otomatik uyutur.</li>
        <li>Tek tıkla <strong>RAM Temizle</strong> veya sekme bazlı anlık uyutma (<strong>Uyutuldu</strong>) desteği sunar.</li>
        <li>Sekme uyandırıldığında sayfa konumu ve video süresi kaldığı yerden devam eder.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>Dahili Reklam ve İzleyici Kalkanı</h3>
      <ul>
        <li>Reklam sunucularını, izleme piksellerini ve analitik takipçilerini ağ & DOM katmanında engeller.</li>
        <li>Video platformları dahil istenmeyen reklamları sayfa yüklenirken filtreler.</li>
        <li>Oturum ve sekme bazlı canlı engelleme istatistiği gösterir.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Ücretsiz Dahili Poly VPN</h3>
      <ul>
        <li><strong>5 farklı ülke konumu:</strong> Almanya, Hollanda, Fransa, İngiltere ve ABD.</li>
        <li>Canlı gecikme testi ile en hızlı düğümü otomatik seçer.</li>
        <li><strong>WebRTC IP sızıntı koruması</strong> ve Gizli Sekme tüneli yerleşik olarak aktiftir.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>Şifre Kasası ve Windows Doğrulama</h3>
      <ul>
        <li>Şifreler <strong>Windows DPAPI (AES-256)</strong> ile yalnızca cihazınıza özel şifrelenerek saklanır.</li>
        <li>Şifre doldurma ve görüntüleme öncesi <strong>Windows Hello / PIN</strong> doğrulaması ister (1 dk güvenli oturum).</li>
        <li>Chrome, Edge ve Firefox'tan tek tıkla <code>.csv</code> / <code>.html</code> veya profil aktarımı destekler.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Bölünmüş Ekran ve Medya</h3>
      <ul>
        <li><strong>Split View:</strong> İki farklı siteyi aynı pencerede yan yana açıp kullanın.</li>
        <li><strong>Tam Ekran Video:</strong> Tüm video oynatıcılarda gerçek monitör boyutuna yayılan tam ekran desteği.</li>
        <li><strong>Canlı Yazdırma Önizleme (Ctrl + P):</strong> Sayfaları PDF olarak kaydetmeden önce canlı önizleyin.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>Kişiselleştirilebilir Arayüz</h3>
      <ul>
        <li><strong>Koyu ve Açık Mod</strong> desteği ile seçilebilir 6 farklı vurgu rengi.</li>
        <li>Yeni Sekme saati, özelleştirilebilir <strong>Hızlı Erişim</strong> kartları ve Gizli Sekme izolasyonu.</li>
        <li>Yalnızca Yeni Sekme'de veya tüm sayfalarda görünen esnek <strong>Yer İmleri Çubuğu</strong>.</li>
      </ul>
    </td>
  </tr>
</table>

---

## Kurulum

1. [**Releases**](https://github.com/MehmetShin/PolyBrowser/releases/tag/v1.3.4) sayfasından en güncel **`PolyBrowser Install.exe`** kurulum dosyasını indirin.
2. Kurulum sihirbazını çalıştırın; Poly Tarayıcı otomatik olarak kurulacak ve sonraki güncellemeleri uygulama içinden kendisi denetleyecektir.

> [!NOTE]
> **Windows SmartScreen Uyarısı Hakkında:**  
> Kurulum paketi yeni yayınlandığı için Windows ilk açılışta *"Windows bilgisayarınızı korudu"* uyarısı gösterebilir. **Ek bilgi → Yine de çalıştır** adımıyla kurulumu güvenle başlatabilirsiniz.

> [!IMPORTANT]
> **Windows 11 "Akıllı Uygulama Denetimi" Engeli:**  
> Eğer kurulum dosyası *"Akıllı Uygulama Denetimi bu uygulamayı engelledi"* uyarısı nedeniyle hiç açılmıyorsa, **Windows Güvenliği → Uygulama ve tarayıcı denetimi → Akıllı Uygulama Denetimi** ayarını **Kapalı** duruma getirip tekrar çalıştırabilirsiniz. *(Not: Windows 11'de bu özellik kapatıldığında temiz kurulum yapılmadan tekrar etkinleştirilemez.)*

---

## Güvenlik Mimarisi ve Gizlilik

Poly Browser, kullanıcı verilerini dış dünyaya ve zararlı sitelere karşı çok katmanlı olarak izole eder:

- **Tam Sandbox İzolasyonu:** Tüm web sekmeleri `sandbox: true`, `contextIsolation: true` ve `nodeIntegration: false` politikalarıyla izole süreçlerde çalıştırılır.
- **Tehlikeli Site ve SSL Koruması:** Oltalama (phishing) adresleri ve geçersiz HTTPS sertifikaları yüklenmeden engellenir.
- **Electron Binary Sertleştirme (Fuses):** `RunAsNode=false`, `CookieEncryption=true`, `AsarIntegrity=true` ve `OnlyLoadFromAsar=true` aktif olarak derlenir.
- **Mark-of-the-Web ve SHA-256 Bütünlük:** İndirilen dosyalar Windows Güvenlik Bölgesi ile işaretlenir; tarayıcı güncellemeleri SHA-256 doğrulamasından geçer.

### VirusTotal ve SHA-256 Doğrulaması

| Dosya | SHA-256 Özeti | VirusTotal Sonucu |
| :--- | :--- | :--- |
| **`PolyBrowser Install.exe`** | `47a2d5d1857b6e777b759fba285b8644a8b667215eead38b90b182b855be6fb7` | [Raporu İncele](https://www.virustotal.com/gui/file/47a2d5d1857b6e777b759fba285b8644a8b667215eead38b90b182b855be6fb7/detection) |
| **`Poly.exe`** | `dd7ce5b849f992598b058bcc821164f2cbbd44dbf93a5e2ed026ed1c2dd39a0d` | [Raporu İncele](https://www.virustotal.com/gui/file/dd7ce5b849f992598b058bcc821164f2cbbd44dbf93a5e2ed026ed1c2dd39a0d/detection) |

> *Not: Kurulum paketinde ücretli ticari kod imzalama sertifikası henüz bulunmadığından VirusTotal üzerindeki 68 motordan yalnızca Trapmine düşük ML skoru (`Suspicious.low.ml.score`) bildirmektedir; diğer 67 antivirüs motorunun tamamı temizdir.*

---

## Klavye Kısayolları

<details>
<summary><strong>Tüm klavye kısayollarını görüntülemek için tıklayın</strong></summary>

| Kısayol | İşlev |
| :--- | :--- |
| `Ctrl + T` | Yeni sekme aç |
| `Ctrl + Shift + N` | Yeni gizli sekme aç |
| `Ctrl + W` / `Ctrl + F4` | Aktif sekmeyi kapat |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | Sekmeler arasında ileri / geri geçiş |
| `Ctrl + 1 .. 9` | İlgili sıradaki sekmeye geç |
| `Ctrl + L` / `Alt + D` / `F6` | Adres çubuğuna odaklan |
| `F5` / `Ctrl + R` | Sayfayı yenile (`Ctrl + F5` önbelleksiz) |
| `Ctrl + +` / `Ctrl + -` / `Ctrl + 0` | Yakınlaştır / Uzaklaştır / %100 Sıfırla |
| `Ctrl + Fare Tekerleği` | Chrome tarzı canlı sayfa ölçekleme |
| `Ctrl + P` | Canlı PDF yazdırma önizlemesi |
| `Ctrl + H` / `Ctrl + J` / `Ctrl + D` | Geçmiş / İndirmeler / Yer imlerine ekle |
| `F11` / `Esc` | Tam ekran ve açık panel/popup kapatma |
| `F12` / `Ctrl + Shift + I` | Geliştirici Araçlarını aç |

</details>

---

## Geliştiriciler İçin

<details>
<summary><strong>Kaynak koddan çalıştırma ve kurulum derleme adımları</strong></summary>

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır
npm start

# Güvenli tek parça Windows kurulum (.exe) derle
npm run build:installer
```

- **Çalışma Zamanı:** Electron 35 (Chromium 134 / V8)
- **Paketleme:** `@electron/packager` + `@electron/fuses` + Inno Setup 6 (`lzma2`)

</details>

---

<div align="center">

**Poly Browser** • [Resmi Web Sitesi](https://polybrowser.com.tr/) • [GitHub Releases](https://github.com/MehmetShin/PolyBrowser/releases) • [Sorun Bildir](https://github.com/MehmetShin/PolyBrowser/issues)

MIT Lisansı ile lisanslanmıştır © 2026 Poly Browser

</div>
