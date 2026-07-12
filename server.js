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

// [설정] 마감 시간: 4강 1경기 시작 시간 (2026년 7월 15일 오전 04:00 KST)
const DEADLINE = new Date('2026-07-15T04:00:00+09:00');

// 🏆 [실시간 경기 결과 입력창] 경기가 끝날 때마다 이 객체만 업데이트해 주시면 됩니다.
const ACTUAL_RESULT = {
    semiFinals: ["프랑스", "스페인", "잉글랜드", "아르헨티나"], // 예시: ["프랑스", "스페인", "잉글랜드", "네덜란드"]
    winner: "",            // 최종 우승국
    runnerUp: ""           // 최종 준우승국
};

// 🎯 [점수 계산 체계]
function calculateScore(pred) {
    let score = 0;
    
    // 1. 4강 진출팀 적중 (각 10점, 최대 40점)
    pred.semi_finals.forEach(team => {
        if (ACTUAL_RESULT.semiFinals.includes(team)) {
            score += 10;
        }
    });

    // 2. 최종 우승팀 적중 (40점)
    if (ACTUAL_RESULT.winner && pred.winner === ACTUAL_RESULT.winner) {
        score += 40;
    }

    // 3. 최종 준우승팀 적중 (30점)
    if (ACTUAL_RESULT.runner_up && pred.runner_up === ACTUAL_RESULT.runnerUp) {
        score += 30;
    }
    
    return score;
}

// 1. 예측 제출 API (DB에 Upsert 방식으로 안전하게 저장 및 시간 동기화)
app.post('/api/predict', async (req, res) => {
    if (new Date() > DEADLINE) {
        return res.status(403).json({ success: false, message: "마감 시간이 지나 제출할 수 없습니다." });
    }

    // 프론트엔드에서 넘어온 submittedAt 추가 수신
    const { nickname, semiFinals, winner, runnerUp, submittedAt } = req.body;
    if (!nickname || !semiFinals || semiFinals.length !== 4 || !winner || !runnerUp) {
        return res.status(400).json({ success: false, message: "모든 항목을 올바르게 입력해주세요." });
    }

    if (semiFinals[0] !== "프랑스") {
        return res.status(400).json({ success: false, message: "매치 1은 이미 프랑스 승리로 종료되었습니다." });
    }

    if (semiFinals[1] !== "스페인") {
        return res.status(400).json({ success: false, message: "매치 2은 이미 스페인 승리로 종료되었습니다." });
    }

    if (semiFinals[2] !== "잉글랜드") {
        return res.status(400).json({ success: false, message: "매치 3은 이미 잉글랜드 승리로 종료되었습니다." });
    }

    if (semiFinals[3] !== "아르헨티나") {
        return res.status(400).json({ success: false, message: "매치 4은 이미 아르헨티나 승리로 종료되었습니다." });
    }

    try {
        // 중복된 닉네임이 있으면 덮어쓰고(Update), 없으면 새로 삽입(Insert)하는 안전한 DB 쿼리
        const { error } = await supabase
            .from('predictions')
            .upsert({
                nickname,
                semi_finals: semiFinals,
                winner,
                runner_up: runnerUp,
                // 클라이언트 제출 시간이 유효하면 파싱하여 저장하고 없으면 서버 시간 반영
                created_at: submittedAt ? new Date(submittedAt) : new Date()
            }, { onConflict: 'nickname' });

        if (error) throw error;

        res.json({ success: true, message: "안전하게 데이터베이스에 저장되었습니다!" });
    } catch (error) {
        console.error("DB 저장 실패:", error);
        res.status(500).json({ success: false, message: "데이터베이스 오류가 발생했습니다." });
    }
});

// 2. 전체 결과 및 실시간 랭킹 조회 API
app.get('/api/results', async (req, res) => {
    try {
        // DB에서 전 유저 데이터 조회
        const { data: predictions, error } = await supabase
            .from('predictions')
            .select('*');

        if (error) throw error;

        // 최신 ACTUAL_RESULT를 바탕으로 실시간 점수 계산 및 프론트 전달 규격 조율
        const resultsWithScores = predictions.map(p => ({
            nickname: p.nickname,
            semiFinals: p.semi_finals,
            winner: p.winner,
            runnerUp: p.runner_up,
            score: calculateScore(p),
            timestamp: p.created_at
        }));

        // 점수 기준 정렬 (동점이면 먼저 제출한 순)
        resultsWithScores.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        res.json({
            deadlinePassed: new Date() > DEADLINE,
            actualResult: ACTUAL_RESULT,
            results: resultsWithScores
        });
    } catch (error) {
        console.error("DB 조회 실패:", error);
        res.status(500).json({ success: false, message: "데이터를 불러오는 중 오류가 발생했습니다." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
