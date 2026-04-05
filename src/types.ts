export interface Service {
  id: string;
  name: string;
  description: string;
  icon: string;
  path: string;
  color: string;
}

export interface Registry {
  version: number;
  services: Service[];
}
