# BORD DEV Laboratuvarı

Bu depo isteğe bağlı geliştirme modülüdür. `BORD_MODE=PROD` (varsayılan)
durumunda webapp bu paketi yüklemez ve `/dev` bulunmaz. `BORD_MODE=DEV`
ile webapp `/dev/` ekranını yalnız yerel istemciye açar. Ekran gerçek parser,
BOM, sequencing, PDTS ve webapp fonksiyonlarını çağırır; örnek veya düzenlenmiş
JSON için ana çıktı, fonksiyon çağrıları, kaynak kodu ve A/B farkı gösterir.

## Çalıştırma

BORD çalışma kopyasının kökünde alt depolar kurulu ve `.venv` hazır olmalı:

```sh
.venv/bin/pip install -e ./bord-devtools
BORD_MODE=DEV .venv/bin/uvicorn app:app --app-dir anvex-webapp --host 127.0.0.1 --port 8000 --reload
```

`http://127.0.0.1:8000/dev/` adresini açın. PROD için `BORD_MODE=PROD`
veya değişkeni kaldırın. Mod sunucu başlarken seçilir; değiştirdikten sonra
sunucuyu yeniden başlatın. DEV yerel erişimle sınırlıdır. Paylaşılan örnek
sunucusunda etkinleştirmeyin.

## Kapsam ve güncellik

39 küçük deney ve uçtan uca CAD örneği güncel çalışma kopyasındaki fonksiyonları
çalıştırır. `runtime.py` hesap algoritmalarını kopyalamaz; webapp'in kanonik
`_apply_canonical_mtm_times` fonksiyonuna da doğrudan bağlanır. Kaynak SHA'ları
her sayfa yüklemesinde hesaplanır. Önerilen `--reload` komutu Python kodu
değiştiğinde sunucuyu yeniden başlatır; başka başlatma yöntemi kullanılıyorsa
değişiklikten sonra sunucuyu yeniden başlatın. Yeni bir fonksiyona özel örnek
ve açıklama istenirse `lessons.py` içine küçük bir adaptör eklenir; algoritma
tekrar yazılmaz.

Sabit CAD örneği `anvex-webapp/sample_project` içinden okunur. Deneyler proje
kaydı oluşturmaz. Laboratuvarın kullandığı ayar, ölçüm ve kütle kanıtı doğrudan
girdiden gelir. Sentetik değerler saha doğrulaması değildir. Bu ekran tüm
uygulama işlevleri ve bütün regresyonlar için sertifika sayılmaz.

### Hat dengeleme benchmarkı

`/dev/#line-benchmark` ekranında iş numarası, iş adı, süre ve öncül iş
numaraları girilir. İstasyon ve toplam operatör sayısı ile elle takt veya
vardiya/mola/talep hesabı seçilir. İsteğe bağlı olarak istasyon başına operatör
sayıları, iş türü, insan meşguliyeti, makine/ortak kaynak kimliği ve sabit
yerleşim de girilebilir. Robot işindeki operatör aralıkları `0-1, 9-10`
biçiminde ayrıca tanımlanabilir; aralıkların toplamı insan meşguliyetine eşit
olmalıdır. Laboratuvar sentetik iş sürelerini bir hat
taslağına aktarır ve üretim ekranının kullandığı `method_balance.balance_line`
ile `apply_balance_result` fonksiyonlarını çalıştırır. Grafik gerçek atama
başlangıç/bitişlerini, iş numaralarını, operatörleri ve takt çizgisini gösterir.
Gözetimsiz makine ile insan işi aynı operatör altında eşzamanlıysa çubuklar yan
yana çizilir; makine çubuğu operatör meşguliyeti anlamına gelmez. Hedefe uygun
çözüm bulunamazsa `unknown` ile küçük vaka aramasında kanıtlanmış
`proven_infeasible` durumu ayrı gösterilir. Etkileşimli kesin arama en çok
12 iş, 6 istasyon, 12 operatör ve 2.000 arama düğümüyle sınırlıdır; sınır
aşılırsa sonuç kanıtsız kalır.
İstasyonlar arası zaman eksenleri yereldir. Basit alt sınır karşılaştırması
optimum çözüm kanıtı değildir. İş süreleri burada girilir; PMTS yeniden
hesaplanmaz ve proje veritabanına yazılmaz.

## Test

```sh
.venv/bin/python -m pytest bord-devtools/test_lab.py -q
```
