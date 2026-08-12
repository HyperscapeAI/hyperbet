import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

type MountedRoot = {
  container: HTMLElement;
  root: { render: (ui: ReactElement) => void; unmount: () => void };
};

const mountedRoots = new Set<MountedRoot>();

export function render(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  const mountedRoot: MountedRoot = { container, root };
  mountedRoots.add(mountedRoot);

  act(() => {
    root.render(ui);
  });

  return {
    container,
    unmount() {
      mountedRoots.delete(mountedRoot);
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function cleanupRenderedTrees() {
  for (const mountedRoot of mountedRoots) {
    act(() => {
      mountedRoot.root.unmount();
    });
    mountedRoot.container.remove();
  }
  mountedRoots.clear();
}

export function click(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

export function changeValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  act(() => {
    const previousValue = element.value;
    const prototype =
      element instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    const valueTracker = (
      element as (HTMLInputElement | HTMLSelectElement) & {
        _valueTracker?: { setValue: (nextValue: string) => void };
      }
    )._valueTracker;
    valueTracker?.setValue(previousValue);
    element.dispatchEvent(
      new Event("input", { bubbles: true, cancelable: true }),
    );
    element.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true }),
    );
  });
}

export function getButtonByText(container: ParentNode, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) {
    throw new Error(`Unable to find button with label: ${label}`);
  }
  return match as HTMLButtonElement;
}

export function getByTestId(container: ParentNode, testId: string) {
  const match = container.querySelector(`[data-testid="${testId}"]`);
  if (!match) {
    throw new Error(`Unable to find element with data-testid=${testId}`);
  }
  return match as HTMLElement;
}
