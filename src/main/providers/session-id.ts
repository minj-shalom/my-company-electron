/** 제공자 CLI가 돌려준 대화 세션 id의 허용 형식. 옵션이나 경로로 해석될 수 있는 값을 막는다. */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/
