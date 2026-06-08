'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { api } from '../../../lib/api';
import ResumeUpload from '../../../components/ResumeUpload';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';
import { Loader2, Save, User, ClipboardList, Plus, Trash2 } from 'lucide-react';

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', target_title: '', target_location: '', keywords: '',
  whatsapp_number: '', university: '', department: '', semester: '', cgpa: '',
  cnic: '', date_of_birth: '', address: '', linkedin_url: '', github_url: '',
};

export default function Profile() {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (!user) return;
      try {
        const profiles = await api.getProfiles(user.id);
        let p = profiles?.[0];
        if (!p) p = await api.createProfile({ user_id: user.id, email: user.email });

        setProfile(p);
        setProfileId(p.id);
        setForm({
          full_name:       p.full_name ?? '',
          email:           p.email ?? user.email ?? '',
          phone:           p.phone ?? '',
          target_title:    p.target_title ?? '',
          target_location: p.target_location ?? '',
          keywords:        (p.keywords ?? []).join(', '),
          whatsapp_number: p.whatsapp_number ?? '',
          university:      p.university ?? '',
          department:      p.department ?? '',
          semester:        p.semester ?? '',
          cgpa:            p.cgpa ?? '',
          cnic:            p.cnic ?? '',
          date_of_birth:   p.date_of_birth ?? '',
          address:         p.address ?? '',
          linkedin_url:    p.linkedin_url ?? '',
          github_url:      p.github_url ?? '',
        });
        const pd = p.personal_details || {};
        setExtras(Object.entries(pd).map(([key, value]) => ({ key, value: String(value) })));
      } catch (e) {
        toast(e.message, 'error');
      }
      setLoading(false);
    };
    init();
  }, []);

  const f = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const personal_details = Object.fromEntries(
        extras.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      );
      const updated = await api.updateProfile(profileId, {
        full_name:       form.full_name || null,
        email:           form.email || null,
        phone:           form.phone || null,
        target_title:    form.target_title || null,
        target_location: form.target_location || null,
        keywords:        form.keywords.split(',').map(s => s.trim()).filter(Boolean),
        whatsapp_number: form.whatsapp_number || null,
        university:      form.university || null,
        department:      form.department || null,
        semester:        form.semester || null,
        cgpa:            form.cgpa || null,
        cnic:            form.cnic || null,
        date_of_birth:   form.date_of_birth || null,
        address:         form.address || null,
        linkedin_url:    form.linkedin_url || null,
        github_url:      form.github_url || null,
        personal_details,
      });
      setProfile(updated);
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message ?? 'Failed to save', 'error');
    }
    setSaving(false);
  };

  const onResumeDone = useCallback((result) => {
    setProfile(p => ({ ...p, resume_text: result?.resume_text }));
    toast(`Resume parsed (${result?.chars ?? 0} chars extracted)`, 'success');
  }, []);

  const addExtra = () => setExtras(prev => [...prev, { key: '', value: '' }]);
  const removeExtra = (i) => setExtras(prev => prev.filter((_, idx) => idx !== i));
  const updateExtra = (i, field, val) =>
    setExtras(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner /></div>
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Profile</h1>
        <p className="text-sm t-b mt-0.5">Your details and resume power every AI match, tailored email, and form auto-fill</p>
      </div>

      {(!profile?.resume_text || !form.target_title) && (
        <div className="px-4 py-3 rounded-xl text-sm
          bg-amber-50 border border-amber-200 text-amber-800
          dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
          <strong>Profile incomplete.</strong> Add your{!profile?.resume_text ? ' resume' : ''}{!profile?.resume_text && !form.target_title ? ' and' : ''}{!form.target_title ? ' target job title' : ''} to enable AI matching.
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        <Section icon={<User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />} title="Personal Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name">
              <input className="input" value={form.full_name} onChange={f('full_name')} placeholder="Jane Smith" />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={form.email} onChange={f('email')} placeholder="jane@example.com" />
            </Field>
            <Field label="Phone">
              <input className="input" value={form.phone} onChange={f('phone')} placeholder="+92 300 1234567" />
            </Field>
            <Field label="WhatsApp number">
              <input className="input" value={form.whatsapp_number} onChange={f('whatsapp_number')} placeholder="+92 300 1234567 (if different)" />
            </Field>
            <Field label="Date of birth">
              <input className="input" value={form.date_of_birth} onChange={f('date_of_birth')} placeholder="2001-03-15" />
            </Field>
            <Field label="CNIC">
              <input className="input" value={form.cnic} onChange={f('cnic')} placeholder="12345-1234567-1" />
            </Field>
          </div>
          <Field label="Address">
            <input className="input" value={form.address} onChange={f('address')} placeholder="Street, City, Country" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="LinkedIn URL">
              <input className="input" value={form.linkedin_url} onChange={f('linkedin_url')} placeholder="https://linkedin.com/in/…" />
            </Field>
            <Field label="GitHub URL">
              <input className="input" value={form.github_url} onChange={f('github_url')} placeholder="https://github.com/…" />
            </Field>
          </div>
        </Section>

        <Section icon={<ClipboardList className="w-4 h-4 text-violet-600 dark:text-violet-400" />} title="Academic Details"
          subtitle="Used to auto-fill university, department and semester fields in forms">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="University / Institution">
              <input className="input" value={form.university} onChange={f('university')} placeholder="FAST NUCES, Lahore" />
            </Field>
            <Field label="Department / Faculty">
              <input className="input" value={form.department} onChange={f('department')} placeholder="Computer Science" />
            </Field>
            <Field label="Semester / Year of study">
              <input className="input" value={form.semester} onChange={f('semester')} placeholder="5th Semester / 3rd Year" />
            </Field>
            <Field label="CGPA / Percentage">
              <input className="input" value={form.cgpa} onChange={f('cgpa')} placeholder="3.8 / 4.0" />
            </Field>
          </div>
        </Section>

        <Section icon={<User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />} title="Job Search Preferences">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Target job title">
              <input className="input" value={form.target_title} onChange={f('target_title')} placeholder="Software Engineer" />
            </Field>
            <Field label="Preferred location">
              <input className="input" value={form.target_location} onChange={f('target_location')} placeholder="Lahore, Pakistan" />
            </Field>
          </div>
          <Field label="Keywords (comma-separated)">
            <input className="input" value={form.keywords} onChange={f('keywords')} placeholder="Python, FastAPI, machine learning, TypeScript" />
            <p className="text-xs t-m mt-1">Used for Adzuna job discovery</p>
          </Field>
        </Section>

        <Section icon={<Plus className="w-4 h-4 text-orange-500 dark:text-orange-400" />} title="Extra Details"
          subtitle="Any other info you want the AI to use when filling forms — debate experience, skills, hobbies, etc.">
          <div className="space-y-2">
            {extras.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  className="input w-36 shrink-0"
                  value={row.key}
                  onChange={e => updateExtra(i, 'key', e.target.value)}
                  placeholder="Field name"
                />
                <input
                  className="input flex-1"
                  value={row.value}
                  onChange={e => updateExtra(i, 'value', e.target.value)}
                  placeholder="Value"
                />
                <button type="button" onClick={() => removeExtra(i)}
                  className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addExtra}
              className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium mt-1 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add field
            </button>
          </div>
          {extras.length === 0 && (
            <p className="text-xs t-m mt-1">
              Example: <span className="font-mono">Debate experience</span> → <span className="font-mono">3 years competitive debate, LUMS Open 2024 finalist</span>
            </p>
          )}
        </Section>

        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save profile
        </button>
      </form>

      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Resume</h2>
        <p className="text-sm t-b mb-4">Upload a PDF — Gemini will extract the text for AI matching and tailoring</p>
        {profile?.resume_text && <ResumePreview text={profile.resume_text} />}
        {profileId && <ResumeUpload profileId={profileId} onDone={onResumeDone} />}
      </div>
    </div>
  );
}

function Section({ icon, title, subtitle, children }) {
  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-slate-100 dark:bg-white/8 rounded-lg flex items-center justify-center">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs t-b">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function ResumePreview({ text }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.06]">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium t-b">Current resume (parsed text)</p>
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Parsed</span>
      </div>
      <p className={`text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line font-mono leading-relaxed ${expanded ? '' : 'line-clamp-5'}`}>
        {expanded ? text : text.slice(0, 500) + (text.length > 500 ? '…' : '')}
      </p>
      {text.length > 500 && (
        <button onClick={() => setExpanded(v => !v)}
          className="text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mt-1.5 cursor-pointer">
          {expanded ? 'Collapse' : 'View full resume'}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium t-b mb-1.5">{label}</label>
      {children}
    </div>
  );
}
