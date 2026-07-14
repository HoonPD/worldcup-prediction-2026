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
// 호스팅 서버의 로컬 시간대에 영향받지 않도록 밀리초(ms) 절대값으로 환산하여 관리합니다.
const DEADLINE_MS = new Date('2026-07-15T04:00:00+09:00').getTime();

// 🏆 [실시간 경기 결과 입력창] 
// 경기 진행 상황에 따라 확정된 값만 채워 넣으시면 실시간으로 점수가 순차 반영됩니다!
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
    if (ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length > 0) {
        if (ACTUAL_RESULT.finalists.includes(pred.finalist_a)) score += 15;
        if (ACTUAL_RESULT.finalists.includes(pred.finalist_b)) score += 15;
    }

    // 2. 최종 우승팀 적중 계산 (30점)
    if (ACTUAL_RESULT.winner && pred.winner === ACTUAL_RESULT.winner) {
        score += 30;
    }

    // 3. 결승전 필드 스코어 적중 계산 (최대 40점)
    if (
        ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreA !== undefined &&
        ACTUAL_RESULT.scoreB !== null && ACTUAL_RESULT.scoreB !== undefined
    ) {
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

// 1. 예측 제출 API
app.post('/api/predict', async (req, res) => {
    // ⏱️ 절대 타임스탬프 기준 마감 시간 체크 (서버 타임존 오류 원천 차단)
    if (Date.now() > DEADLINE_MS) {
        return res.status(403).json({ success: false, message: "마감 시간이 지나 제출할 수 없습니다." });
    }

    const { nickname, finalistA, finalistB, winner, scoreA, scoreB, submittedAt } = req.body;
    
    if (!nickname || !finalistA || !finalistB || !winner || scoreA === undefined || scoreB === undefined) {
        return res.status(400).json({ success: false, message: "모든 항목을 올바르게 입력해주세요." });
    }

    const sA = parseInt(scoreA);
    const sB = parseInt(scoreB);
    if (sA > sB && winner !== finalistA) {
        return res.status(400).json({ success: false, message: `예측 스코어상 ${finalistA}가 승리하지만, 우승국은 ${winner}로 설정되어 모순이 발생합니다.` });
    }
    if (sB > sA && winner !== finalistB) {
        return res.status(400).json({ success: false, message: `예측 스코어상 ${finalistB}가 승리하지만, 우승국은 ${winner}로 설정되어 모순이 발생합니다.` });
    }

    try {
        const { error } = await supabase
            .from('predictions')
            .upsert({
                nickname,
                finalist_a: finalistA,
                finalist_b: finalistB,
                winner,
                score_a: sA,
                score_b: sB,
                created_at: submittedAt ? new Date(submittedAt) : new Date()
            }, { onConflict: 'nickname' });

        if (error) throw error;

        res.json({ success: true, message: "예측이 성공적으로 저장(업데이트)되었습니다!" });
    } catch (error) {
        console.error("DB 저장 실패:", error);
        res.status(500).json({ success: false, message: "데이터베이스 오류가 발생했습니다." });
    }
});

// 2. 전체 결과 및 실시간 랭킹 조회 API
app.get('/api/results', async (req, res) => {
    try {
        const { data: predictions, error } = await supabase
            .from('predictions')
            .select('*');

        if (error) throw error;

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

        // ⏱️ 동점자 처리 규칙: 총점 높은 순 -> 제출 시간이 빠른 순
        resultsWithScores.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        const progress = {
            finalistsDetermined: ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length > 0,
            winnerDetermined: ACTUAL_RESULT.winner !== null && ACTUAL_RESULT.winner !== undefined,
            scoresDetermined: ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreB !== null
        };

        res.json({
            deadlinePassed: Date.now() > DEADLINE_MS, // 절대 타임스탬프 기준으로 전달
            progress: progress,
            actualResult: ACTUAL_RESULT,
            results: resultsWithScores
        });
    } catch (error) {
        console.error("DB 조회 실패:", error);
        res.status(500).json({ success: false, message: "데이터를 불러오는 중 오류가 발생했습니다." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
