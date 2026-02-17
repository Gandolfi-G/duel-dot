interface HomePageProps {
  nickname: string;
  onNicknameChange: (value: string) => void;
  onSubmit: () => void;
}

export function HomePage({ nickname, onNicknameChange, onSubmit }: HomePageProps) {
  const isSubmitDisabled = nickname.trim().length === 0;

  return (
    <section className="card card-sm">
      <h1>Duel Multiplications</h1>
      <p className="subtitle">Le duel de calcul mental entre collégiens.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="nickname">Ton pseudo</label>
        <input
          id="nickname"
          type="text"
          value={nickname}
          onChange={(event) => onNicknameChange(event.target.value)}
          maxLength={20}
          placeholder="Ex: Samira"
        />

        <button type="submit" className="primary-btn" disabled={isSubmitDisabled}>
          Continuer
        </button>
      </form>
    </section>
  );
}
