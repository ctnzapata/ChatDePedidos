import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { LoginForm } from "./login-page";

const renderForm = (onSubmit: (email: string, password: string) => Promise<void>) =>
  render(<MemoryRouter><LoginForm onSubmit={onSubmit} /></MemoryRouter>);

describe("LoginForm", () => {
  it("submits email and password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(onSubmit);

    await userEvent.type(screen.getByLabelText("Correo"), "ana@ejemplo.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "una-clave-segura");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(onSubmit).toHaveBeenCalledWith("ana@ejemplo.com", "una-clave-segura");
  });

  it("validates the email before submitting", async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    await userEvent.type(screen.getByLabelText("Correo"), "no-es-correo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("correo válido");
  });

  it("shows the error when sign-in fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Correo o contraseña incorrectos."));
    renderForm(onSubmit);

    await userEvent.type(screen.getByLabelText("Correo"), "ana@ejemplo.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "mala");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.");
  });

  it("toggles password visibility", async () => {
    renderForm(vi.fn());
    const password = screen.getByLabelText("Contraseña");

    await userEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));

    expect(password).toHaveAttribute("type", "text");
  });
});
