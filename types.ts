export interface Service {
  id: string;
  title: string;
  description: string;
  price: string;
  duration: string;
  image: string;
}

export interface Testimonial {
  id: string;
  name: string;
  role: string;
  content: string;
  rating: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export enum NavLink {
  HOME = 'home',
  SERVICES = 'services',
  ABOUT = 'about',
  CONSULT = 'consult',
  CONTACT = 'contact'
}