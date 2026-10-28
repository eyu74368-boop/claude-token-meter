# claude-token-meter

[English](README.md) | 한국어

토큰이 어디로 새는지 보여 주고, 긴 세션이 비싸지기 전에 알려 주는 Claude Code 모드입니다.

<!-- screenshot: 효율 창 (차트 + 주간 / 5시간 한도 막대) -->
<!-- screenshot: 토큰·도구 점검 창 -->
<!-- screenshot: 세션 크기 알림 띠 -->

## 기능

1. **토큰 효율 창** - 턴마다 컨텍스트 크기와 효율 차트, 주간·5시간 한도 막대.
2. **토큰·도구 점검 창** - 커넥터·플러그인·MCP 서버가 세션 시작 때 얼마나 드는지, 실제로 어느 것을 썼는지 보여 주고 켜고 끌 수 있습니다.
3. **세션 크기 알림** - 효율이 떨어지면 단계별로 알리고, 시작 짐이 무거우면 경고하며, 프롬프트 캐시 만료까지 남은 시간을 셉니다. 기록은 `~/.claude/token-meter/`에 쌓이고 자동으로 정리됩니다.

## 핵심 개념

**효율 = 시작 짐 ÷ 현재 컨텍스트.**
매 턴마다 컨텍스트 전체를 다시 읽습니다. 대화가 길어질수록 고정된 시작 짐(시스템 프롬프트, 도구, 커넥터)의 비중은 작아집니다. 효율이 약 **40%** 아래면 새 세션을 여는 편이 보통 더 쌉니다.

## 설치

터미널 세션의 프롬프트에서:

```
/plugin install claude-token-meter --marketplace eyu74368-boop/claude-token-meter
```

셸에서:

```
claude plugin install claude-token-meter --marketplace eyu74368-boop/claude-token-meter
```

데스크톱 앱(`/plugin`이 안 되는 곳): 입력창 옆 **+** → **Plugins** → **Add marketplace**에 `eyu74368-boop/claude-token-meter` 입력 → **Add plugin**.

## 설정

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `effWarn` | 40 | 효율 경고선(%), 이 아래면 빨강 |
| `effCaution` | 50 | 효율 주의선(%), 이 아래면 주황 |
| `alertSteps` | `40,30,22` | 쉼표로 구분한 효율 단계. 각 단계 아래로 처음 떨어질 때 알림 |
| `wasteTokens` | 15000 | 한 턴에 컨텍스트가 이보다 많이 늘면 낭비로 기록 |
| `cacheTtlMin` | 60 | 프롬프트 캐시 유지 시간(분), 만료 카운트다운용 |
| `cacheMinChat` | 40000 | 대화 부분이 이보다 작으면 캐시 만료 알림 생략(토큰) |
| `startPayload` | 60000 | 첫 응답의 입력이 이보다 크면 경고(토큰) |
| `keepDays` | 30 | 이보다 오래된 기록은 로그에서 정리 |
| `language` | `auto` | `auto`, `en`, `ko` |

## 언어

기본은 Claude의 `language` 설정을 따릅니다. 한국어면 한국어, 그 외는 영어입니다. `language` 옵션을 `en` 또는 `ko`로 정하면 고정됩니다.

## 개인정보

모든 처리는 내 컴퓨터 안에서만 합니다. 어디로도 전송하지 않습니다. 모드가 파일을 쓰는 곳은 두 군데입니다.

- `~/.claude/token-meter/`: 모드 자체 기록(자동 정리)
- `~/.claude/settings.json`: 점검 패널에서 플러그인을 켜거나 끌 때만. Claude Code에 이를 위한 API가 없어서 그 플러그인의 `enabledPlugins` 항목만 고치고 다른 설정은 그대로 둡니다. 켜기·끄기 버튼을 쓰지 않으면 이 파일은 건드리지 않습니다.

## 요구 사항

모드(함수 훅)를 지원하는 Claude Code.

## 라이선스

MIT - [LICENSE](LICENSE) 참고.
