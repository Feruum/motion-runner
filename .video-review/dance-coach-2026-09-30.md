# Dance Party / Duo QA — 2026-09-30

## Результат

- Проверка корня: 296 unit-тестов прошли; сборка и typecheck API прошли.
- На текущем `mirror-coach.ts` (SHA-256 `FCB1773AAA85703ED22D9F1CB8EAACB91B9D5B808EA59F45A20EAC4791C98B04`) быстрый рендер-тест загрузил настоящие Rogue и Knight GLB и проверил все 8 авторских cue: 1/1 тест прошёл. Визуально поднятые руки видны сбоку от головы, подошвы шаговых cue стоят на платформе. Снято 16 кадров: `.video-review/dance-glb-final3-20260930/dance-presenter-actual-Rog-5d79f-s-with-the-front-facing-rig/`.
- Production E2E: Mirror Challenge, Dance Solo, picker и все 4 варианта Six/Seven прошли в изолированном production build. Duo прошёл отдельный повтор после исправления тестовой recovery-позы на двух игроков в нейтральной стойке и проверки уже выполненного cue через существующий счётчик прогресса. Duo завершил полный раунд с 8 синхронными фразами; повтор — 1/1, без flaky-тестов.

## Скриншоты

- [Dance Solo — desktop, обе руки подняты](./dance-coach-solo.png)
- [Dance Duo — desktop, шаг](./dance-coach-duo.png)
- [Dance Solo — mobile, наклон](./dance-coach-mobile.png)

Полные production E2E артефакты находятся в `.video-review/dance-demo-production-final-20260930-results/` и `.video-review/dance-duo-progress-retry-20260930-results/`.

## Ограничение проверки

Камера и PoseWorker в браузерных сценариях заменены синтетическими landmark-кадрами. Это проверяет UI, scoring, паузу/восстановление, завершение и replay, но не точность распознавания реальной веб-камеры. Отдельный рендер-тест использует настоящие GLB-модели и программно подаёт cue.
