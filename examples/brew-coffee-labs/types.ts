// types.ts
export type Recipe = {
    id: string;
    name: string;
    nickname: string;
    date: string;
    likes: number;  // Ensure this is number
    isLiked: boolean;
    profileImage: { uri: string };
    image: { uri: string };
    ingredients: any;
    instructions: any;
  };

  export type LabSelections = {
    temperature: 'hot' | 'iced' | 'cold-brew';
    strength: 'light' | 'medium' | 'dark';
    sweetness: 'none' | 'slight' | 'sweet';
    milk: 'none' | 'regular' | 'oat' | 'almond' | 'soy';
    flavor: 'none' | 'vanilla' | 'caramel' | 'hazelnut' | 'chocolate';
    cupSize: 'small' | 'medium' | 'large';
    machine: 'manual' | 'drip' | 'pod' | 'espresso';
    extraShot: boolean;
  };