import { SignInForm } from "@/client/SignInForm";

export default function HomePage() {
  return (
    <main className="page">
      <h1>Resonance</h1>
      <p className="lede">
        A music discovery engine that optimizes one thing: tracks you confirm you love and had
        never heard before.
      </p>
      <section aria-labelledby="signin-heading" className="card">
        <h2 id="signin-heading">Sign in or create your account</h2>
        <p>
          No password. No streaming service required — recommendations are built only from what you
          tell Resonance and how you respond here.
        </p>
        <SignInForm />
      </section>
    </main>
  );
}
