export default function Message(props: { title: string; text?: string; action?: { label: string; run: () => void } }) {
  return (
    <main className="page center">
      <h1>{props.title}</h1>
      {props.text && <p className="muted">{props.text}</p>}
      {props.action && (
        <button className="btn" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </main>
  );
}
