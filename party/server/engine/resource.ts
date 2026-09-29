export interface ResourcePool {
  id: string;
  name: string;
  amount: number;
  max: number;
}

export function createResource(id: string, name: string, amount: number, max: number): ResourcePool {
  const safeMax = Math.max(0, max);
  return { id, name, amount: Math.max(0, Math.min(safeMax, amount)), max: safeMax };
}

export function spendResource(resource: ResourcePool, amount: number): boolean {
  const cost = Math.max(0, amount);
  if (resource.amount < cost) return false;
  resource.amount -= cost;
  return true;
}

export function addResource(resource: ResourcePool, amount: number): number {
  resource.amount = Math.min(resource.max, resource.amount + Math.max(0, amount));
  return resource.amount;
}
