// @ts-nocheck
import { prisma } from '@workspace/db';

export class CalendarService {
    static async sendMeetingInvites(EmailService: any, event: any, creator: any, appUrl: string) {
        if (event.type !== 'meeting') return;

        const { startTime, endTime, platform, meetingLink, location, agenda, attendees, externalAttendees, clients, notes } = event;

        const emailTargets: any[] = [];

        if (attendees && attendees.length) {
            attendees.forEach((u: any) => {
                if (u && u.email) emailTargets.push({ email: u.email, name: u.name });
            });
        }

        if (clients && clients.length) {
            clients.forEach((c: any) => {
                if (c && c.email) emailTargets.push({ email: c.email, name: c.name });
            });
        }

        if (externalAttendees && externalAttendees.length) {
            externalAttendees.forEach((email: string) => emailTargets.push({ email, name: email }));
        }

        if (!emailTargets.length) return;

        const dateStr = new Date(event.startDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        for (const target of emailTargets) {
            try {
                await EmailService.notify(target, 'meeting_scheduled', {
                    meetingTitle: event.title,
                    startDate: dateStr,
                    startTime: startTime,
                    endTime: endTime,
                    platform: platform,
                    location: location,
                    agenda: agenda,
                    notes: notes,
                    creatorName: creator?.name || 'Workspace Team',
                    ctaUrl: meetingLink || `${appUrl}/dashboard/calendar`
                });
            } catch (e: any) {
                console.error(`Failed to send meeting invite to ${target.email}:`, e.message);
            }
        }
    }

    static async getEvents(filter: any) {
        return prisma.calendarEvent.findMany({
            where: filter,
            include: {
                createdBy: { select: { name: true } },
                attendees: { select: { id: true, name: true, email: true, photoUrl: true, role: true } },
                clients: true
            },
            orderBy: { startDate: 'asc' }
        });
    }

    static async createEvent(data: any) {
        return prisma.calendarEvent.create({
            data,
            include: { attendees: true, clients: true }
        });
    }

    static async getEventById(id: string) {
        return prisma.calendarEvent.findFirst({
            where: { id },
            include: {
                attendees: { select: { id: true, name: true, email: true, photoUrl: true, role: true } },
                clients: true
            }
        });
    }

    static async updateEvent(id: string, data: any) {
        return prisma.calendarEvent.update({
            where: { id },
            data,
            include: {
                attendees: { select: { id: true, name: true, email: true, photoUrl: true, role: true } },
                clients: true
            }
        });
    }

    static async deleteEvent(id: string) {
        return prisma.calendarEvent.delete({
            where: { id }
        });
    }

    static async getUser(id: string) {
        return prisma.user.findUnique({
            where: { id },
            select: { name: true, email: true }
        });
    }
}
