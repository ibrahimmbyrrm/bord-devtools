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

38 küçük deney ve uçtan uca CAD örneği güncel çalışma kopyasındaki fonksiyonları
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

## Test

```sh
.venv/bin/python -m pytest bord-devtools/test_lab.py -q
```
