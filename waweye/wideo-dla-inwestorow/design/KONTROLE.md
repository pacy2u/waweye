# Kontrole – uruchamiane przed każdą bramką (też w kolejnych filmach)

| Kontrola | Jak | Skrypt |
| --- | --- | --- |
| spelling-and-facts | każde słowo, nazwa i liczba zgodna z briefem albo źródłem | ręcznie, `design/SCENARIUSZ.md` |
| text-safe-area | ramka wszystkich glifów w 5 % od krawędzi | `video/scripts/kontrola-tekstu.mjs` |
| no-collisions | panele przejść + arkusz klatek, oglądane | `design/przejscia/`, arkusz klatek |
| text-contrast | ≥ 4,5:1 na pikselach za literami (klatka z tekstem vs „ghost”) | `video/scripts/kontrola-tekstu.mjs` |
| frame-sheet | 1 klatka/s, oglądana; czarne, błyski, zamrożenia | `video/scripts/kontrola-wideo.sh` |
| format | ≥ 1080p (animatik 720p), stałe 30 kl./s, H.264 + AAC, czas ±5 % | `video/scripts/kontrola-wideo.sh` |
| loudness | −14 LUFS ±1, true peak ≤ −1 dBTP | `video/scripts/kontrola-wideo.sh` |
| sync | początek słowa na ekranie vs prawdziwy początek mowy w klipie, ≤ 2 kl. | `video/scripts/kontrola-synchronizacji.mjs` |

## Dopisane po błędach, których żadna kontrola nie złapała

| Kontrola | Błąd, który ją wywołał | Jak |
| --- | --- | --- |
| number-meaning | w briefie „2 634 pojazdy na żywo”, a to liczba taboru w rejestrze (na żywo było 1 091) | przy każdej liczbie na ekranie w scenariuszu: pole zbioru danych i jego definicja |
| no-transient-numbers | liczby w beacie 3 „nabijały się” od zera, więc na ekranie pojawiało się np. 1 060, którego nie ma w danych | liczby wchodzą w całości; arkusz klatek oglądany pod tym kątem |
| near-empty-frames | klatka 0 animatiku była prawie pusta (sama kropka), a `blackdetect` jej nie złapał, bo tło nie jest czarne | `kontrola-wideo.sh`: co 0,5 s udział pikseli różnych od tła ≥ 1 % |
