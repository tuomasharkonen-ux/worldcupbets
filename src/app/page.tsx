import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

// Root redirects to today (the daily-loop home) if logged in, else to the join page
export default async function Home() {
  const session = await getSession();
  if (session.managerId) {
    redirect('/today');
  } else {
    redirect('/join');
  }
}
