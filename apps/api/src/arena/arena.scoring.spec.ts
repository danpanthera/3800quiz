import { QuestionType } from '@prisma/client';
import {
  gradeArenaAnswer,
  computeResponseMs,
  rankAndScoreBuzzes,
  compareTeamsForRanking,
  buildTeamRoundResults,
  type RankableBuzz,
  type RankableTeam,
  type TeamForReveal,
  type BuzzForReveal,
} from './arena.scoring';

describe('gradeArenaAnswer', () => {
  const singleQuestion = {
    questionType: QuestionType.SINGLE,
    options: [
      { id: 'a', isCorrect: true, orderIndex: 1 },
      { id: 'b', isCorrect: false, orderIndex: 2 },
    ],
  };

  const multipleQuestion = {
    questionType: QuestionType.MULTIPLE,
    options: [
      { id: 'a', isCorrect: true, orderIndex: 1 },
      { id: 'b', isCorrect: true, orderIndex: 2 },
      { id: 'c', isCorrect: false, orderIndex: 3 },
    ],
  };

  const orderingQuestion = {
    questionType: QuestionType.ORDERING,
    options: [
      { id: 'x', isCorrect: false, orderIndex: 2 },
      { id: 'y', isCorrect: false, orderIndex: 1 },
      { id: 'z', isCorrect: false, orderIndex: 3 },
    ],
  };

  it('SINGLE: chọn đúng đáp án là đúng', () => {
    expect(gradeArenaAnswer(singleQuestion, ['a']).isCorrect).toBe(true);
  });

  it('SINGLE: chọn sai đáp án là sai', () => {
    expect(gradeArenaAnswer(singleQuestion, ['b']).isCorrect).toBe(false);
  });

  it('MULTIPLE: đảo thứ tự chọn vẫn tính đúng (so sánh tập hợp)', () => {
    expect(gradeArenaAnswer(multipleQuestion, ['b', 'a']).isCorrect).toBe(true);
  });

  it('MULTIPLE: thiếu 1 đáp án đúng là sai', () => {
    expect(gradeArenaAnswer(multipleQuestion, ['a']).isCorrect).toBe(false);
  });

  it('ORDERING: đúng thứ tự orderIndex tăng dần là đúng', () => {
    expect(gradeArenaAnswer(orderingQuestion, ['y', 'x', 'z']).isCorrect).toBe(
      true,
    );
  });

  it('ORDERING: SAI thứ tự phải trả false dù đúng bộ đáp án (hồi quy lỗi cũ)', () => {
    expect(gradeArenaAnswer(orderingQuestion, ['x', 'y', 'z']).isCorrect).toBe(
      false,
    );
  });
});

describe('computeResponseMs', () => {
  it('tính bình thường khi không có độ trễ', () => {
    const result = computeResponseMs({
      receivedAtMs: 3412,
      startedAtMs: 0,
      deadlineAtMs: 20000,
      compensationMs: 0,
    });
    expect(result.rawResponseMs).toBe(3412);
    expect(result.responseMs).toBe(3412);
  });

  it('bù trễ giảm đúng thời gian phản hồi', () => {
    const result = computeResponseMs({
      receivedAtMs: 3412,
      startedAtMs: 0,
      deadlineAtMs: 20000,
      compensationMs: 200,
    });
    expect(result.rawResponseMs).toBe(3412);
    expect(result.responseMs).toBe(3212);
  });

  it('kẹp responseMs không bao giờ âm khi bù trễ lớn hơn thời gian thô', () => {
    const result = computeResponseMs({
      receivedAtMs: 100,
      startedAtMs: 0,
      deadlineAtMs: 20000,
      compensationMs: 800,
    });
    expect(result.responseMs).toBe(0);
  });

  it('kẹp responseMs không bao giờ vượt quá thời lượng câu hỏi', () => {
    const result = computeResponseMs({
      receivedAtMs: 25000, // đến sau deadline (được gọi trong khoảng ân hạn)
      startedAtMs: 0,
      deadlineAtMs: 20000,
      compensationMs: 0,
    });
    expect(result.responseMs).toBe(20000);
  });

  it('không bù gì khi compensationMs = 0 (chưa có mẫu RTT)', () => {
    const result = computeResponseMs({
      receivedAtMs: 5000,
      startedAtMs: 0,
      deadlineAtMs: 20000,
      compensationMs: 0,
    });
    expect(result.responseMs).toBe(result.rawResponseMs);
  });
});

describe('rankAndScoreBuzzes', () => {
  const pointsForRank = [10, 7, 5];

  function buzz(
    id: string,
    teamId: string,
    isCorrect: boolean,
    answeredAtMs: number,
  ): RankableBuzz {
    return {
      id,
      teamId,
      isCorrect,
      responseMs: answeredAtMs,
      answeredAt: new Date(answeredAtMs),
    };
  }

  it('gán speedRank cho mọi đáp án theo thứ tự thời gian, kể cả sai', () => {
    const ranked = rankAndScoreBuzzes(
      [
        buzz('1', 'A', true, 3000),
        buzz('2', 'B', false, 1000),
        buzz('3', 'C', true, 2000),
      ],
      pointsForRank,
      0,
    );
    const byTeam = new Map(ranked.map((r) => [r.teamId, r]));
    expect(byTeam.get('B')!.speedRank).toBe(1);
    expect(byTeam.get('C')!.speedRank).toBe(2);
    expect(byTeam.get('A')!.speedRank).toBe(3);
  });

  it('correctRank chỉ gán cho đáp án đúng, đánh số riêng trong nhóm đúng', () => {
    const ranked = rankAndScoreBuzzes(
      [
        buzz('1', 'A', true, 3000),
        buzz('2', 'B', false, 1000),
        buzz('3', 'C', true, 2000),
      ],
      pointsForRank,
      0,
    );
    const byTeam = new Map(ranked.map((r) => [r.teamId, r]));
    expect(byTeam.get('B')!.correctRank).toBeNull();
    expect(byTeam.get('C')!.correctRank).toBe(1); // đúng, đến trước (2000 < 3000)
    expect(byTeam.get('A')!.correctRank).toBe(2);
    expect(byTeam.get('C')!.pointsAwarded).toBe(10);
    expect(byTeam.get('A')!.pointsAwarded).toBe(7);
  });

  it('pointsForRank hết phần tử thì dùng giá trị cuối cùng của mảng', () => {
    const ranked = rankAndScoreBuzzes(
      [
        buzz('1', 'A', true, 1000),
        buzz('2', 'B', true, 2000),
        buzz('3', 'C', true, 3000),
        buzz('4', 'D', true, 4000),
      ],
      [10, 7],
      0,
    );
    const byTeam = new Map(ranked.map((r) => [r.teamId, r]));
    expect(byTeam.get('C')!.pointsAwarded).toBe(7); // hạng 3, dùng giá trị cuối
    expect(byTeam.get('D')!.pointsAwarded).toBe(7); // hạng 4, vẫn giá trị cuối
  });

  it('penaltyWrong = 0 thì đáp án sai không bị trừ điểm', () => {
    const ranked = rankAndScoreBuzzes(
      [buzz('1', 'A', false, 1000)],
      pointsForRank,
      0,
    );
    expect(ranked[0].pointsAwarded).toBe(0);
  });

  it('penaltyWrong > 0 thì đáp án sai bị trừ đúng số điểm phạt', () => {
    const ranked = rankAndScoreBuzzes(
      [buzz('1', 'A', false, 1000)],
      pointsForRank,
      5,
    );
    expect(ranked[0].pointsAwarded).toBe(-5);
  });

  it('phá hoà tất định bằng id khi trùng answeredAt', () => {
    const ranked = rankAndScoreBuzzes(
      [buzz('zzz', 'A', true, 1000), buzz('aaa', 'B', true, 1000)],
      pointsForRank,
      0,
    );
    // 'aaa' < 'zzz' theo localeCompare nên B phải xếp trước A
    expect(ranked.find((r) => r.teamId === 'B')!.speedRank).toBe(1);
    expect(ranked.find((r) => r.teamId === 'A')!.speedRank).toBe(2);
  });
});

describe('compareTeamsForRanking', () => {
  function team(
    id: string,
    score: number,
    correctCount: number,
    totalAnswerMs: number,
    joinedAtMs: number,
  ): RankableTeam {
    return {
      id,
      score,
      correctCount,
      totalAnswerMs,
      joinedAt: new Date(joinedAtMs),
    };
  }

  it('điểm cao hơn thắng', () => {
    const a = team('A', 20, 0, 0, 0);
    const b = team('B', 10, 0, 0, 0);
    expect(compareTeamsForRanking(a, b)).toBeLessThan(0);
  });

  it('bằng điểm: nhiều câu đúng hơn thắng', () => {
    const a = team('A', 10, 5, 0, 0);
    const b = team('B', 10, 3, 0, 0);
    expect(compareTeamsForRanking(a, b)).toBeLessThan(0);
  });

  it('bằng điểm và số câu đúng: tổng thời gian ngắn hơn thắng', () => {
    const a = team('A', 10, 3, 5000, 0);
    const b = team('B', 10, 3, 8000, 0);
    expect(compareTeamsForRanking(a, b)).toBeLessThan(0);
  });

  it('bằng cả 3 tiêu chí: vào phòng sớm hơn thắng', () => {
    const a = team('A', 10, 3, 5000, 1000);
    const b = team('B', 10, 3, 5000, 2000);
    expect(compareTeamsForRanking(a, b)).toBeLessThan(0);
  });
});

describe('buildTeamRoundResults', () => {
  const teams: TeamForReveal[] = [
    { id: 'A', name: 'Đội A', color: '#E74C3C' },
    { id: 'B', name: 'Đội B', color: '#3498DB' },
    { id: 'C', name: 'Đội C', color: '#2ECC71' },
  ];

  function makeBuzz(overrides: Partial<BuzzForReveal>): BuzzForReveal {
    return {
      teamId: 'A',
      isCorrect: true,
      selectedOptionIds: ['opt-1'],
      responseMs: 1000,
      rawResponseMs: 1000,
      latencyMs: 0,
      speedRank: 1,
      correctRank: 1,
      pointsAwarded: 10,
      scoreBefore: 0,
      scoreAfter: 10,
      ...overrides,
    };
  }

  it('đội không trả lời vẫn có 1 hàng với outcome no_answer và scoreBefore = scoreAfter = điểm hiện tại', () => {
    const buzzesByTeamId = new Map([['A', makeBuzz({ teamId: 'A' })]]);
    const currentScoreByTeamId = new Map([
      ['A', 10],
      ['B', 25],
      ['C', 0],
    ]);
    const rankBefore = new Map([
      ['A', 2],
      ['B', 1],
      ['C', 3],
    ]);
    const rankAfter = new Map([
      ['A', 1],
      ['B', 1],
      ['C', 3],
    ]);

    const results = buildTeamRoundResults(
      teams,
      buzzesByTeamId,
      currentScoreByTeamId,
      rankBefore,
      rankAfter,
    );

    const teamB = results.find((r) => r.teamId === 'B')!;
    expect(teamB.outcome).toBe('no_answer');
    expect(teamB.responseMs).toBeNull();
    expect(teamB.selectedOptionIds).toEqual([]);
    expect(teamB.scoreBefore).toBe(25);
    expect(teamB.scoreAfter).toBe(25);
    expect(teamB.pointsDelta).toBe(0);
  });

  it('tính rankDelta đúng (dương = thăng hạng)', () => {
    const buzzesByTeamId = new Map([['A', makeBuzz({ teamId: 'A' })]]);
    const currentScoreByTeamId = new Map([
      ['A', 10],
      ['B', 25],
      ['C', 0],
    ]);
    const rankBefore = new Map([['A', 2]]);
    const rankAfter = new Map([['A', 1]]);

    const results = buildTeamRoundResults(
      teams,
      buzzesByTeamId,
      currentScoreByTeamId,
      rankBefore,
      rankAfter,
    );
    const teamA = results.find((r) => r.teamId === 'A')!;
    expect(teamA.rankDelta).toBe(1); // 2 - 1 = thăng 1 hạng
  });

  it('sắp thứ tự: đúng theo tốc độ → sai theo tốc độ → không trả lời', () => {
    const buzzesByTeamId = new Map([
      [
        'A',
        makeBuzz({
          teamId: 'A',
          isCorrect: true,
          correctRank: 2,
          speedRank: 2,
        }),
      ],
      [
        'B',
        makeBuzz({
          teamId: 'B',
          isCorrect: false,
          correctRank: null,
          speedRank: 1,
          pointsAwarded: 0,
        }),
      ],
    ]);
    const currentScoreByTeamId = new Map([
      ['A', 0],
      ['B', 0],
      ['C', 0],
    ]);
    const rankBefore = new Map<string, number>();
    const rankAfter = new Map<string, number>();

    const results = buildTeamRoundResults(
      teams,
      buzzesByTeamId,
      currentScoreByTeamId,
      rankBefore,
      rankAfter,
    );

    expect(results.map((r) => r.teamId)).toEqual(['A', 'B', 'C']);
    expect(results.map((r) => r.outcome)).toEqual([
      'correct',
      'wrong',
      'no_answer',
    ]);
  });

  it('isFastestCorrect chỉ true khi correctRank === 1', () => {
    const buzzesByTeamId = new Map([
      ['A', makeBuzz({ teamId: 'A', correctRank: 1 })],
      ['B', makeBuzz({ teamId: 'B', correctRank: 2 })],
    ]);
    const currentScoreByTeamId = new Map([
      ['A', 0],
      ['B', 0],
      ['C', 0],
    ]);
    const results = buildTeamRoundResults(
      teams,
      buzzesByTeamId,
      currentScoreByTeamId,
      new Map(),
      new Map(),
    );
    expect(results.find((r) => r.teamId === 'A')!.isFastestCorrect).toBe(true);
    expect(results.find((r) => r.teamId === 'B')!.isFastestCorrect).toBe(false);
  });
});
