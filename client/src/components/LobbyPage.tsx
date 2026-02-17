interface LobbyPageProps {
  nickname: string;
  joinCode: string;
  onJoinCodeChange: (value: string) => void;
  onCreateSession: () => void;
  onJoinSession: () => void;
  feedback: string;
}

export function LobbyPage({
  nickname,
  joinCode,
  onJoinCodeChange,
  onCreateSession,
  onJoinSession,
  feedback
}: LobbyPageProps) {
  return (
    <section className="card">
      <h2>Salut {nickname} !</h2>
      <p className="subtitle">Crée un duel ou rejoins ton adversaire.</p>

      <div className="actions-grid">
        <button type="button" onClick={onCreateSession} className="primary-btn large-btn">
          Créer une session
        </button>

        <div className="join-box">
          <label htmlFor="code">Code de session</label>
          <input
            id="code"
            type="text"
            value={joinCode}
            onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
            maxLength={5}
            placeholder="AB12C"
          />
          <button type="button" onClick={onJoinSession} className="secondary-btn large-btn">
            Rejoindre
          </button>
        </div>
      </div>

      {feedback ? <p className="feedback">{feedback}</p> : null}
    </section>
  );
}
