/**
 * ESTADOS BRASILEIROS
 * 
 * Lista completa de UFs e regiões do Brasil
 */

export interface BrazilianState {
  uf: string;
  name: string;
  region: string;
}

export const BRAZILIAN_STATES: BrazilianState[] = [
  // Norte
  { uf: "AC", name: "Acre", region: "Norte" },
  { uf: "AP", name: "Amapá", region: "Norte" },
  { uf: "AM", name: "Amazonas", region: "Norte" },
  { uf: "PA", name: "Pará", region: "Norte" },
  { uf: "RO", name: "Rondônia", region: "Norte" },
  { uf: "RR", name: "Roraima", region: "Norte" },
  { uf: "TO", name: "Tocantins", region: "Norte" },
  
  // Nordeste
  { uf: "AL", name: "Alagoas", region: "Nordeste" },
  { uf: "BA", name: "Bahia", region: "Nordeste" },
  { uf: "CE", name: "Ceará", region: "Nordeste" },
  { uf: "MA", name: "Maranhão", region: "Nordeste" },
  { uf: "PB", name: "Paraíba", region: "Nordeste" },
  { uf: "PE", name: "Pernambuco", region: "Nordeste" },
  { uf: "PI", name: "Piauí", region: "Nordeste" },
  { uf: "RN", name: "Rio Grande do Norte", region: "Nordeste" },
  { uf: "SE", name: "Sergipe", region: "Nordeste" },
  
  // Centro-Oeste
  { uf: "DF", name: "Distrito Federal", region: "Centro-Oeste" },
  { uf: "GO", name: "Goiás", region: "Centro-Oeste" },
  { uf: "MT", name: "Mato Grosso", region: "Centro-Oeste" },
  { uf: "MS", name: "Mato Grosso do Sul", region: "Centro-Oeste" },
  
  // Sudeste
  { uf: "ES", name: "Espírito Santo", region: "Sudeste" },
  { uf: "MG", name: "Minas Gerais", region: "Sudeste" },
  { uf: "RJ", name: "Rio de Janeiro", region: "Sudeste" },
  { uf: "SP", name: "São Paulo", region: "Sudeste" },
  
  // Sul
  { uf: "PR", name: "Paraná", region: "Sul" },
  { uf: "RS", name: "Rio Grande do Sul", region: "Sul" },
  { uf: "SC", name: "Santa Catarina", region: "Sul" },
];

export const REGIONS = [
  "Norte",
  "Nordeste",
  "Centro-Oeste",
  "Sudeste",
  "Sul",
];

export function getStatesByRegion(region: string): BrazilianState[] {
  return BRAZILIAN_STATES.filter((state) => state.region === region);
}

export function getStateByUF(uf: string): BrazilianState | undefined {
  return BRAZILIAN_STATES.find((state) => state.uf === uf);
}
