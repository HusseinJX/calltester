let answerMode = (process.env.ANSWER_MODE === 'ai' ? 'ai' : 'manual');

export function getAnswerMode() {
  return answerMode;
}

export function setAnswerMode(mode) {
  if (mode === 'ai' || mode === 'manual') {
    answerMode = mode;
  }
}

