import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

// Root redirects to fixtures if logged in, otherwise to the join page
export default async function Home() {
  const session = await getSession();
  if (session.managerId) {
    redirect('/fixtures');
  } else {
    redirect('/join');
  }
}
