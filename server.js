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
const DEADLINE_MS = new Date('2026-07-15T04:00:00+09:00').getTime();

// 🏆 [실시간 경기 결과 입력창] - 요청하신 규격으로 완벽 수정
const ACTUAL_RESULT = {
    finalists: ["스페인", "아르헨티나"],      // 1단계: 결승 진출국 확정 시 입력 (예: ["프랑스", "아르헨티나"])
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
    // 두 결승 진출국이 모두 확정되고 스코어가 입력되었을 때 작동합니다.
    if (
        ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length === 2 &&
        ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreA !== undefined &&
        ACTUAL_RESULT.scoreB !== null && ACTUAL_RESULT.scoreB !== undefined
    ) {
        const actualTeamA = ACTUAL_RESULT.finalists[0];
        const actualTeamB = ACTUAL_RESULT.finalists[1];

        let predScoreA = null;
        let predScoreB = null;

        // 경우 1: 유저 예측 순서와 실제 결승 대진 배열 순서가 정방향 일치하는 경우
        if (pred.finalist_a === actualTeamA && pred.finalist_b === actualTeamB) {
            predScoreA = pred.score_a;
            predScoreB = pred.score_b;
        }
        // 경우 2: 유저 예측 순서와 실제 결승 대진 배열 순서가 서로 엇갈린(반대) 경우
        else if (pred.finalist_a === actualTeamB && pred.finalist_b === actualTeamA) {
            predScoreA = pred.score_b;
            predScoreB = pred.score_a;
        }

        // 유저가 예측한 두 팀이 모두 결승에 진출했을 경우에만 스코어 비교 시작
        if (predScoreA !== null && predScoreB !== null) {
            
            // ① 승무패 및 골득실 차이 적중 여부 계산 (+15점)
            const actualDiff = ACTUAL_RESULT.scoreA - ACTUAL_RESULT.scoreB;
            const predDiff = predScoreA - predScoreB;

            const isOutcomeMatch = (Math.sign(actualDiff) === Math.sign(predDiff)) && (actualDiff === predDiff);
            if (isOutcomeMatch) score += 15;

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
        res.json({ success: true, message: "예측이 성공적으로 저장되었습니다!" });
    } catch (error) {
        console.error("DB 저장 실패:", error);
        res.status(500).json({ success: false, message: "데이터베이스 오류가 발생했습니다." });
    }
});

// 2. 전체 결과 및 실시간 랭킹 조회 API
app.get('/api/results', async (req, res) => {
    try {
        const { data: predictions, error } = await supabase.from('predictions').select('*');
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

        resultsWithScores.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        const progress = {
            finalistsDetermined: ACTUAL_RESULT.finalists && ACTUAL_RESULT.finalists.length > 0,
            winnerDetermined: ACTUAL_RESULT.winner !== null,
            scoresDetermined: ACTUAL_RESULT.scoreA !== null && ACTUAL_RESULT.scoreB !== null
        };

        res.json({
            deadlinePassed: Date.now() > DEADLINE_MS,
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
