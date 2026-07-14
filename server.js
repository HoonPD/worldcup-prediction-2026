const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔗 Supabase 클라이언트 초기화 (환경변수 연동)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 📅 [설정] 마감 시간: 4강 1경기 시작 시간 (2026년 7월 15일 오전 04:00 KST)
const DEADLINE = new Date('2026-07-15T04:00:00+09:00');

// 🏆 [실시간 경기 결과 입력창] 
// 경기 진행 상황에 따라 확정된 값만 채워 넣으시면 실시간으로 점수가 순차 반영됩니다!
// (예: 4강이 끝나면 finalists와 teamA, teamB만 먼저 적고 winner, scoreA, scoreB는 null로 유지)
const ACTUAL_RESULT = {
    finalists: ["스페인"],      // 1단계: 결승 진출국 확정 시 입력 (예: ["프랑스", "아르헨티나"])
    teamA: "스페인",        // 결승전 왼쪽 배치 팀 (예: "프랑스")
    teamB: null,        // 결승전 오른쪽 배치 팀 (예: "아르헨티나")
    winner: null,       // 2단계: 최종 우승팀 확정 시 입력 (예: "아르헨티나")
    scoreA: null,       // 3단계: 결승전 최종 스코어 확정 시 입력 (예: 3)
    scoreB: null        // 3단계: 결승전 최종 스코어 확정 시 입력 (예: 1)
};

// 🎯 [단계별 실시간 점수 계산 체계]
function calculateScore(pred) {
    let score = 0;

    // 1. 결승 진출국 적중 계산 (각 15점, 최대 30점)
    // finalists 배열에 국가가 채워졌을 때만 작동합니다.
    if (ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length > 0) {
        if (ACTUAL_RESULT.finalists.includes(pred.finalist_a)) score += 15;
        if (ACTUAL_RESULT.finalists.includes(pred.finalist_b)) score += 15;
    }

    // 2. 최종 우승팀 적중 계산 (30점)
    // winner 값이 null이 아닐 때만 작동합니다.
    if (ACTUAL_RESULT.winner && pred.winner === ACTUAL_RESULT.winner) {
        score += 30;
    }

    // 3. 결승전 필드 스코어 적중 계산 (최대 40점)
    // scoreA와 scoreB가 모두 null이나 undefined가 아닐 때만 작동합니다.
    if (
        ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreA !== undefined &&
        ACTUAL_RESULT.scoreB !== null && ACTUAL_RESULT.scoreB !== undefined
    ) {
        // 유저가 예측한 A팀과 B팀의 스코어를 실제 결과 국가(teamA, teamB)에 맞게 재정렬
        let predScoreA = null;
        let predScoreB = null;

        // 유저 예측 A가 실제 teamA인 경우
        if (pred.finalist_a === ACTUAL_RESULT.teamA) {
            predScoreA = pred.score_a;
            predScoreB = pred.score_b;
        } 
        // 유저 예측 A가 실제 teamB인 경우 (순서가 뒤바뀐 경우)
        else if (pred.finalist_a === ACTUAL_RESULT.teamB) {
            predScoreA = pred.score_b;
            predScoreB = pred.score_a;
        }

        // 유저가 예측한 두 팀이 결승에 실제로 모두 진출했을 때만 스코어 세부 점수 계산 시작
        if (predScoreA !== null && predScoreB !== null) {
            
            // ① 승무패 및 골득실 차이 적중 여부 계산 (+15점)
            const actualDiff = ACTUAL_RESULT.scoreA - ACTUAL_RESULT.scoreB;
            const predDiff = predScoreA - predScoreB;
            
            // 양수/음수/0의 방향이 같고, 골득실 차이의 절대값까지 같아야 함
            const isOutcomeMatch = (Math.sign(actualDiff) === Math.sign(predDiff)) && (actualDiff === predDiff);
            
            if (isOutcomeMatch) {
                score += 15;
            }

            // ② 각 팀별 정확한 스코어 개별 적중 여부 (+10점씩, 최대 20점)
            const isTeamAMatch = (predScoreA === ACTUAL_RESULT.scoreA);
            const isTeamBMatch = (predScoreB === ACTUAL_RESULT.scoreB);

            if (isTeamAMatch) score += 10;
            if (isTeamBMatch) score += 10;

            // ③ 올킬 보너스 (+5점)
            if (isOutcomeMatch && isTeamAMatch && isTeamBMatch) {
                score += 5;
            }
        }
    }
    
    return score;
}

// 1. 예측 제출 API (새로운 결승 폼 규격에 맞게 매핑 및 데이터 유효성 검사)
app.post('/api/predict', async (req, res) => {
    // ⏱️ 마감 시간 체크
    if (new Date() > DEADLINE) {
        return res.status(403).json({ success: false, message: "마감 시간이 지나 제출할 수 없습니다." });
    }

    const { nickname, finalistA, finalistB, winner, scoreA, scoreB, submittedAt } = req.body;
    
    // 입력값 누락 검증 (스코어는 0점일 수 있으므로 undefined 조건으로 체크)
    if (!nickname || !finalistA || !finalistB || !winner || scoreA === undefined || scoreB === undefined) {
        return res.status(400).json({ success: false, message: "모든 항목을 올바르게 입력해주세요." });
    }

    // ⚽ 모순 검증 로직 (필드 스코어로 승패가 났을 때, 우승국 선택과 매칭이 맞는지 확인)
    const sA = parseInt(scoreA);
    const sB = parseInt(scoreB);
    if (sA > sB && winner !== finalistA) {
        return res.status(400).json({ success: false, message: `예측 스코어상 ${finalistA}가 승리하지만, 우승국은 ${winner}로 설정되어 모순이 발생합니다.` });
    }
    if (sB > sA && winner !== finalistB) {
        return res.status(400).json({ success: false, message: `예측 스코어상 ${finalistB}가 승리하지만, 우승국은 ${winner}로 설정되어 모순이 발생합니다.` });
    }

    try {
        // ⏱️ 내용과 시간을 모두 덮어씌웁니다. 
        // 닉네임이 같으면 최신 데이터 및 현재 시간(또는 프론트 전달 시간)으로 완전히 업데이트됩니다.
        const { error } = await supabase
            .from('predictions')
            .upsert({
                nickname,
                finalist_a: finalistA,
                finalist_b: finalistB,
                winner,
                score_a: sA,
                score_b: sB,
                created_at: submittedAt ? new Date(submittedAt) : new Date() // 수정 완료 시점의 최신 시간으로 리셋
            }, { onConflict: 'nickname' });

        if (error) throw error;

        res.json({ success: true, message: "예측이 성공적으로 저장(업데이트)되었습니다!" });
    } catch (error) {
        console.error("DB 저장 실패:", error);
        res.status(500).json({ success: false, message: "데이터베이스 오류가 발생했습니다." });
    }
});

// 2. 전체 결과 및 실시간 랭킹 조회 API (단계별 진행 상황 플래그 추가)
app.get('/api/results', async (req, res) => {
    try {
        const { data: predictions, error } = await supabase
            .from('predictions')
            .select('*');

        if (error) throw error;

        // 고도화된 단계별 점수 계산기를 적용하여 데이터 매핑
        const resultsWithScores = predictions.map(p => ({
            nickname: p.nickname,
            finalistA: p.finalist_a,
            finalistB: p.finalist_b,
            winner: p.winner,
            scoreA: p.score_a,
            scoreB: p.score_b,
            score: calculateScore(p),
            timestamp: p.created_at
        }));

        // ⏱️ 동점자 처리 규칙: 
        // 1순위: 총점 높은 순 (내림차순)
        // 2순위: 제출(또는 마지막 수정) 시간이 빠른 순 (오름차순) -> 변경 이력이 있으면 그 최신 시점으로 비교됨!
        resultsWithScores.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        // 📊 [트렌디한 추가 플래그] 관리자가 실제 경기 결과를 어디까지 입력했는지 상태 확인
        const progress = {
            finalistsDetermined: ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length > 0,
            winnerDetermined: ACTUAL_RESULT.winner !== null && ACTUAL_RESULT.winner !== undefined,
            scoresDetermined: ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreB !== null
        };

        res.json({
            deadlinePassed: new Date() > DEADLINE,
            progress: progress, // 💡 프론트엔드에서 안내 메시지 분기 처리용 데이터
            actualResult: ACTUAL_RESULT,
            results: resultsWithScores
        });
    } catch (error) {
        console.error("DB 조회 실패:", error);
        res.status(500).json({ success: false, message: "데이터를 불러오는 중 오류가 발생했습니다." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
