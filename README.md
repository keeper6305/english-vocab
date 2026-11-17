# 회화 영어 단어장 · 6,000 SRS

회화 필수 단어 5,000개(A1~C1) + 구동사·회화 구문·비즈니스 청크 1,000개를
4지선다 · 빈칸 채우기 · 문장 순서 맞추기 · 플래시카드와 Anki식 간격 반복(SRS)으로 익히는 모바일 PWA.

**바로 열기: https://keeper6305.github.io/english-vocab/**

- 홈 화면에 추가하면 앱처럼 전체 화면으로 열리고, 오프라인에서도 동작합니다.
- 학습 기록은 기기 브라우저의 `localStorage`(`vocab5k.v1`)에만 저장됩니다. 서버로 보내지 않습니다.

## 구조

```
index.html  styles.css  app.js  manifest.json  sw.js
data/lv1.js ~ lv5.js, data/meta.js   # 카드 데이터 (레벨별 분할 로딩, 총 6,000장)
icon-*.png  favicon-*.png  apple-touch-icon.png
.nojekyll                           # GitHub Pages 에서 Jekyll 처리 끄기
```

## 수정 사항 반영

1. 파일을 고친 뒤 `sw.js`의 `VERSION` 값을 올립니다 (예: `v3.6.0-gh` → `v3.6.1-gh`).
2. `main` 브랜치에 push 합니다.
3. `index.html`과 `data/*.js`는 network-first 라서 다음 실행에 최신본이 뜨고,
   아이콘·CSS는 캐시 우선 + 백그라운드 갱신, 이전 버전 캐시는 자동 삭제됩니다.

## 출처

NGSL·NGSL-Spoken(CC BY-SA), Oxford 3000/5000, English–Korean dictionary data 등
앱 내 「수록 기준」 화면에 출처를 표기했습니다.
