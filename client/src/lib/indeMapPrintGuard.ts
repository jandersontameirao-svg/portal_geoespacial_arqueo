/** Estado transitório por instância de mapa; não contém dados geográficos, sessão ou persistência. */
const mapStates = new WeakMap<object, Map<string, { ready: boolean; identity: symbol }>>();

export function registerIndeMapPrintState(map: object, id: string, ready: boolean): () => void {
  let states = mapStates.get(map);
  if (!states) { states = new Map(); mapStates.set(map, states); }
  const identity = Symbol(id);
  states.set(id, { ready, identity });
  return () => {
    const current = mapStates.get(map);
    if (current?.get(id)?.identity === identity) current.delete(id);
    if (current?.size === 0) mapStates.delete(map);
  };
}

export function assertIndeMapPrintReady(map: object): void {
  const states = mapStates.get(map);
  if (states && Array.from(states.values()).some(state => !state.ready)) {
    throw new Error("Uma camada INDE marcada ainda não foi exibida ou está com erro. Aguarde seu carregamento ou desative-a antes de imprimir; nenhum PDF parcial foi gerado.");
  }
}
